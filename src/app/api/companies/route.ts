import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  companies,
  companyScores,
  trackedRepos,
  trackedPackages,
  companyCompetitorSignals,
} from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { daysAgoIso } from "@/lib/dates";
import { deriveSegment } from "@/lib/segments";
import type { CompanySummary } from "@/lib/types/api";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");
  const minScore = parseFloat(searchParams.get("minScore") || "0");

  const db = getDb();
  const sevenDaysAgo = daysAgoIso(7);

  // Latest aggregate per scope. `id DESC` tiebreaks the pre-scope duplicate
  // aggregate rows (NULL repo_id never hit the unique index) deterministically.
  const latestAggregate = (companyId: number, scope: "own" | "competitor") =>
    db
      .select()
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = ${scope}`
      )
      .orderBy(desc(companyScores.date), desc(companyScores.id))
      .limit(1)
      .get();

  const allCompanies = db.select().from(companies).all();
  const summaries: CompanySummary[] = [];

  for (const company of allCompanies) {
    const own = latestAggregate(company.id, "own");
    const competitor = latestAggregate(company.id, "competitor");
    if (!own && !competitor) continue;

    const ownScore = own?.score || 0;
    const competitorScore = competitor?.score || 0;
    if (Math.max(ownScore, competitorScore) < minScore) continue;

    // Trend stays own-based — same meaning as before dual scoring.
    const prevScore = db
      .select({ score: companyScores.score })
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${company.id} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = 'own' AND ${companyScores.date} <= ${sevenDaysAgo}`
      )
      .orderBy(desc(companyScores.date), desc(companyScores.id))
      .limit(1)
      .get();

    // Entity labels with activity: per-repo score rows + depends-on packages.
    const repoEntities = db
      .select({
        owner: trackedRepos.owner,
        name: trackedRepos.name,
      })
      .from(companyScores)
      .innerJoin(trackedRepos, sql`${companyScores.repoId} = ${trackedRepos.id}`)
      .where(sql`${companyScores.companyId} = ${company.id} AND ${companyScores.repoId} IS NOT NULL`)
      .groupBy(companyScores.repoId)
      .all();
    const pkgEntities = db
      .select({ name: trackedPackages.name })
      .from(companyCompetitorSignals)
      .innerJoin(
        trackedPackages,
        sql`${companyCompetitorSignals.packageId} = ${trackedPackages.id}`
      )
      .where(sql`${companyCompetitorSignals.companyId} = ${company.id}`)
      .groupBy(companyCompetitorSignals.packageId)
      .all();
    const activeEntities = [
      ...repoEntities.map((r) => `${r.owner}/${r.name}`),
      ...pkgEntities.map((p) => p.name),
    ];

    summaries.push({
      id: company.id,
      name: company.name,
      domain: company.domain,
      website: company.website,
      industry: company.industry,
      employeeCount: company.employeeCount,
      score: ownScore,
      competitorScore,
      segment: deriveSegment(ownScore, competitorScore),
      lastOwnEngagementAt: own?.lastEventDate ?? null,
      lastCompetitorEngagementAt: competitor?.lastEventDate ?? null,
      activeEntities,
      userCount: own?.userCount || 0,
      starCount: own?.starCount || 0,
      forkCount: own?.forkCount || 0,
      issueCount: own?.issueCount || 0,
      prCount: own?.prCount || 0,
      commitCount: own?.commitCount || 0,
      scoreTrend: own && prevScore ? own.score - prevScore.score : 0,
    });
  }

  // The stronger signal wins the default ordering so net-new prospects
  // surface next to hot own-engagement companies.
  summaries.sort(
    (a, b) => Math.max(b.score, b.competitorScore) - Math.max(a.score, a.competitorScore)
  );

  return NextResponse.json(summaries.slice(offset, offset + limit));
}
