import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import type { CompanyDetail } from "@/lib/types/api";
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

  // Users linked to this company
  const userLinks = db
    .select({
      userId: githubUserCompanies.userId,
      source: githubUserCompanies.source,
      confidence: githubUserCompanies.confidence,
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

  // For each user, get their engagement types
  const users = userLinks.map((u) => {
    const events = db
      .select({
        eventType: githubEngagementEvents.eventType,
        count: sql<number>`COUNT(*)`,
      })
      .from(githubEngagementEvents)
      .where(sql`${githubEngagementEvents.userId} = ${u.userId}`)
      .groupBy(githubEngagementEvents.eventType)
      .all();

    return {
      id: u.userId,
      login: u.login,
      name: u.name,
      avatarUrl: u.avatarUrl,
      companyRaw: u.companyRaw,
      source: u.source,
      confidence: u.confidence,
      engagementTypes: events.map((e) => e.eventType),
      eventCount: events.reduce((s, e) => s + e.count, 0),
      competitorEmployee: u.competitorEmployee,
      competitorEmployeeSource: u.competitorEmployeeSource,
    };
  });

  const ownScore = latestScore?.score || 0;
  const competitorScore = latestCompetitorScore?.score || 0;
  const payload: CompanyDetail = {
    ...company,
    score: ownScore,
    competitorScore,
    segment: deriveSegment(ownScore, competitorScore),
    userCount: latestScore?.userCount || 0,
    starCount: latestScore?.starCount || 0,
    forkCount: latestScore?.forkCount || 0,
    issueCount: latestScore?.issueCount || 0,
    prCount: latestScore?.prCount || 0,
    commitCount: latestScore?.commitCount || 0,
    scoreHistory,
    users,
    competitorAttribution,
  };
  return NextResponse.json(payload);
}
