import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  companies, companyScores, githubUserCompanies, githubUsers, githubEngagementEvents,
} from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";

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

  // Latest aggregate score
  const latestScore = db
    .select()
    .from(companyScores)
    .where(sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL`)
    .orderBy(desc(companyScores.date))
    .limit(1)
    .get();

  // Score history
  const scoreHistory = db
    .select({ date: companyScores.date, score: companyScores.score })
    .from(companyScores)
    .where(sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL`)
    .orderBy(companyScores.date)
    .all();

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
    };
  });

  return NextResponse.json({
    ...company,
    score: latestScore?.score || 0,
    userCount: latestScore?.userCount || 0,
    starCount: latestScore?.starCount || 0,
    forkCount: latestScore?.forkCount || 0,
    issueCount: latestScore?.issueCount || 0,
    prCount: latestScore?.prCount || 0,
    commitCount: latestScore?.commitCount || 0,
    scoreHistory,
    users,
  });
}
