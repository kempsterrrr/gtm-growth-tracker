import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { companies, companyScores } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");
  const minScore = parseFloat(searchParams.get("minScore") || "0");

  const db = getDb();
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  // Get companies with their latest aggregate scores
  const results = db
    .select({
      id: companies.id,
      name: companies.name,
      domain: companies.domain,
      website: companies.website,
      industry: companies.industry,
      employeeCount: companies.employeeCount,
      score: companyScores.score,
      userCount: companyScores.userCount,
      starCount: companyScores.starCount,
      forkCount: companyScores.forkCount,
      issueCount: companyScores.issueCount,
      prCount: companyScores.prCount,
      commitCount: companyScores.commitCount,
    })
    .from(companyScores)
    .innerJoin(companies, sql`${companyScores.companyId} = ${companies.id}`)
    .where(
      sql`${companyScores.repoId} IS NULL AND ${companyScores.date} = (
        SELECT MAX(date) FROM company_scores WHERE company_id = ${companies.id} AND repo_id IS NULL
      ) AND ${companyScores.score} >= ${minScore}`
    )
    .orderBy(desc(companyScores.score))
    .limit(limit)
    .offset(offset)
    .all();

  // Add trend data
  const withTrend = results.map((r) => {
    const prevScore = db
      .select({ score: companyScores.score })
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${r.id} AND ${companyScores.repoId} IS NULL AND ${companyScores.date} <= ${sevenDaysAgo}`
      )
      .orderBy(desc(companyScores.date))
      .limit(1)
      .get();

    return {
      ...r,
      scoreTrend: prevScore ? r.score - prevScore.score : 0,
    };
  });

  return NextResponse.json(withTrend);
}
