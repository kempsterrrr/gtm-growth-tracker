import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import type { CompanyDetail, EntityEngagement } from "@/lib/types/api";
import { eventAnchorDate } from "@/lib/decay";
import {
  companies, companyScores, githubUserCompanies, githubUsers, githubEngagementEvents, trackedRepos,
  companyCompetitorSignals, trackedPackages,
} from "@/lib/db/schema";
import { DEPENDS_ON_WEIGHT, MAX_EVENTS_PER_TYPE } from "@/lib/types/scoring";
import { sql, desc } from "drizzle-orm";
import { deriveSegment } from "@/lib/segments";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const companyId = parseInt(id);
  const db = getDb();

  const company = db.select().from(companies).where(sql`${companies.id} = ${companyId}`).get();
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Latest aggregate per scope (`id DESC` tiebreaks legacy duplicate rows)
  const latestAggregate = (scope: "own" | "competitor") =>
    db
      .select()
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = ${scope}`
      )
      .orderBy(desc(companyScores.date), desc(companyScores.id))
      .limit(1)
      .get();
  const latestScore = latestAggregate("own");
  const latestCompetitorScore = latestAggregate("competitor");

  // Score history (own scope — competitor aggregates never blend in)
  const scoreHistory = db
    .select({ date: companyScores.date, score: companyScores.score })
    .from(companyScores)
    .where(
      sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = 'own'`
    )
    .orderBy(companyScores.date)
    .all();

  // Which competitor repos drove the competitor score — latest per-repo row.
  // Rows whose repo has since lost its competitor attribution are skipped.
  const attributionRows = db
    .select({
      owner: trackedRepos.owner,
      name: trackedRepos.name,
      displayName: trackedRepos.displayName,
      competitor: trackedRepos.competitor,
      score: companyScores.score,
      userCount: companyScores.userCount,
      starCount: companyScores.starCount,
      forkCount: companyScores.forkCount,
      issueCount: companyScores.issueCount,
      prCount: companyScores.prCount,
      commitCount: companyScores.commitCount,
    })
    .from(companyScores)
    .innerJoin(trackedRepos, sql`${companyScores.repoId} = ${trackedRepos.id}`)
    .where(
      sql`${companyScores.companyId} = ${companyId} AND ${companyScores.scope} = 'competitor' AND ${companyScores.date} = (
        SELECT MAX(date) FROM company_scores cs2
        WHERE cs2.company_id = ${companyScores.companyId}
          AND cs2.repo_id = ${companyScores.repoId}
          AND cs2.scope = 'competitor'
      )`
    )
    .orderBy(desc(companyScores.score))
    .all();
  const engagementAttribution = attributionRows
    .filter((r) => r.competitor != null)
    .map((r) => ({
      competitor: r.competitor!,
      entity: `${r.owner}/${r.name}`,
      displayName: r.displayName,
      signal: "engagement" as const,
      dependentCount: 0,
      score: r.score,
      userCount: r.userCount,
      starCount: r.starCount,
      forkCount: r.forkCount,
      issueCount: r.issueCount,
      prCount: r.prCount,
      commitCount: r.commitCount,
    }));

  // Depends-on signals (issue #22): one attribution row per competitor
  // package, scored exactly as the scoring step does.
  const signalRows = db
    .select({
      name: trackedPackages.name,
      displayName: trackedPackages.displayName,
      competitor: trackedPackages.competitor,
      n: sql<number>`COUNT(*)`,
    })
    .from(companyCompetitorSignals)
    .innerJoin(trackedPackages, sql`${companyCompetitorSignals.packageId} = ${trackedPackages.id}`)
    .where(sql`${companyCompetitorSignals.companyId} = ${companyId}`)
    .groupBy(companyCompetitorSignals.packageId)
    .all();
  const dependsOnAttribution = signalRows
    .filter((r) => r.competitor != null)
    .map((r) => ({
      competitor: r.competitor!,
      entity: r.name,
      displayName: r.displayName,
      signal: "depends_on" as const,
      dependentCount: r.n,
      score: Math.min(r.n, MAX_EVENTS_PER_TYPE) * DEPENDS_ON_WEIGHT,
      userCount: 0,
      starCount: 0,
      forkCount: 0,
      issueCount: 0,
      prCount: 0,
      commitCount: 0,
    }));
  const competitorAttribution = [...engagementAttribution, ...dependsOnAttribution].sort(
    (a, b) => b.score - a.score
  );

  // Users linked to this company — primary links are the "works here" list;
  // the rest are visible-but-non-scoring affiliations (PRD #42).
  const allLinks = db
    .select({
      userId: githubUserCompanies.userId,
      source: githubUserCompanies.source,
      confidence: githubUserCompanies.confidence,
      isPrimary: githubUserCompanies.isPrimary,
      login: githubUsers.login,
      name: githubUsers.name,
      avatarUrl: githubUsers.avatarUrl,
      companyRaw: githubUsers.companyRaw,
      competitorEmployee: githubUsers.competitorEmployee,
      competitorEmployeeSource: githubUsers.competitorEmployeeSource,
    })
    .from(githubUserCompanies)
    .innerJoin(githubUsers, sql`${githubUserCompanies.userId} = ${githubUsers.id}`)
    .where(sql`${githubUserCompanies.companyId} = ${companyId}`)
    .all();
  const userLinks = allLinks.filter((u) => u.isPrimary === 1);
  const affiliated = allLinks
    .filter((u) => u.isPrimary !== 1)
    .map((u) => ({
      id: u.userId,
      login: u.login,
      name: u.name,
      avatarUrl: u.avatarUrl,
      source: u.source,
    }));

  // For each primary user, break engagement down per entity — provenance
  // beats the old unscoped badge summary (PRD #42).
  const users = userLinks.map((u) => {
    const rows = db
      .select({
        owner: trackedRepos.owner,
        repoName: trackedRepos.name,
        displayName: trackedRepos.displayName,
        competitor: trackedRepos.competitor,
        eventType: githubEngagementEvents.eventType,
        eventDate: githubEngagementEvents.eventDate,
        collectedAt: githubEngagementEvents.collectedAt,
      })
      .from(githubEngagementEvents)
      .innerJoin(trackedRepos, sql`${githubEngagementEvents.repoId} = ${trackedRepos.id}`)
      .where(sql`${githubEngagementEvents.userId} = ${u.userId}`)
      .all();

    const byEntity = new Map<string, EntityEngagement>();
    for (const r of rows) {
      const entity = `${r.owner}/${r.repoName}`;
      let e = byEntity.get(entity);
      if (!e) {
        e = {
          entity,
          displayName: r.displayName,
          competitor: r.competitor,
          starCount: 0,
          forkCount: 0,
          issueCount: 0,
          prCount: 0,
          commitCount: 0,
          lastAt: null,
        };
        byEntity.set(entity, e);
      }
      // Scoring-style type buckets (issue comments count as issues, reviews as PRs)
      if (r.eventType === "star") e.starCount++;
      else if (r.eventType === "fork") e.forkCount++;
      else if (r.eventType === "issue" || r.eventType === "issue_comment") e.issueCount++;
      else if (r.eventType === "pr" || r.eventType === "pr_review") e.prCount++;
      else if (r.eventType === "commit") e.commitCount++;
      const anchor = eventAnchorDate(r.eventDate, r.collectedAt);
      if (!e.lastAt || anchor > e.lastAt) e.lastAt = anchor;
    }
    const engagements = [...byEntity.values()].sort((a, b) =>
      (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
    );

    return {
      id: u.userId,
      login: u.login,
      name: u.name,
      avatarUrl: u.avatarUrl,
      companyRaw: u.companyRaw,
      source: u.source,
      confidence: u.confidence,
      engagements,
      competitorEmployee: u.competitorEmployee,
      competitorEmployeeSource: u.competitorEmployeeSource,
    };
  });

  // Entity labels with activity — same derivation as the list route.
  const repoEntities = db
    .select({ owner: trackedRepos.owner, name: trackedRepos.name })
    .from(companyScores)
    .innerJoin(trackedRepos, sql`${companyScores.repoId} = ${trackedRepos.id}`)
    .where(sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NOT NULL`)
    .groupBy(companyScores.repoId)
    .all();
  const pkgEntities = db
    .select({ name: trackedPackages.name })
    .from(companyCompetitorSignals)
    .innerJoin(trackedPackages, sql`${companyCompetitorSignals.packageId} = ${trackedPackages.id}`)
    .where(sql`${companyCompetitorSignals.companyId} = ${companyId}`)
    .groupBy(companyCompetitorSignals.packageId)
    .all();
  const activeEntities = [
    ...repoEntities.map((r) => `${r.owner}/${r.name}`),
    ...pkgEntities.map((p) => p.name),
  ];

  const ownScore = latestScore?.score || 0;
  const competitorScore = latestCompetitorScore?.score || 0;
  const payload: CompanyDetail = {
    ...company,
    score: ownScore,
    competitorScore,
    segment: deriveSegment(ownScore, competitorScore),
    lastOwnEngagementAt: latestScore?.lastEventDate ?? null,
    lastCompetitorEngagementAt: latestCompetitorScore?.lastEventDate ?? null,
    activeEntities,
    userCount: latestScore?.userCount || 0,
    starCount: latestScore?.starCount || 0,
    forkCount: latestScore?.forkCount || 0,
    issueCount: latestScore?.issueCount || 0,
    prCount: latestScore?.prCount || 0,
    commitCount: latestScore?.commitCount || 0,
    scoreHistory,
    users,
    affiliated,
    competitorAttribution,
  };
  return NextResponse.json(payload);
}
