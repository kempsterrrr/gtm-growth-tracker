import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { githubUsers, githubUserCompanies, companies } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { entityEngagementsFor } from "@/lib/user-engagements";
import type { PersonSummary } from "@/lib/types/api";

export async function GET() {
  const db = getDb();

  // Every engaged human exactly once (PRD #42) — enriched-but-silent users
  // don't belong on a working list.
  const engagedUsers = db
    .select()
    .from(githubUsers)
    .where(
      sql`EXISTS (SELECT 1 FROM github_engagement_events WHERE user_id = ${githubUsers.id})`
    )
    .all();

  const people: PersonSummary[] = engagedUsers.map((u) => {
    const primary = db
      .select({
        companyId: githubUserCompanies.companyId,
        source: githubUserCompanies.source,
        name: companies.name,
      })
      .from(githubUserCompanies)
      .innerJoin(companies, sql`${githubUserCompanies.companyId} = ${companies.id}`)
      .where(sql`${githubUserCompanies.userId} = ${u.id} AND ${githubUserCompanies.isPrimary} = 1`)
      .get();

    const engagements = entityEngagementsFor(db, u.id);
    const lastActive = engagements.find((e) => e.lastAt)?.lastAt ?? null;

    return {
      id: u.id,
      login: u.login,
      name: u.name,
      avatarUrl: u.avatarUrl,
      primaryCompany: primary
        ? { id: primary.companyId, name: primary.name, source: primary.source }
        : null,
      competitorEmployee: u.competitorEmployee,
      competitorEmployeeSource: u.competitorEmployeeSource,
      engagements,
      lastActive,
    };
  });

  // Freshest first; never-dated people sink to the bottom.
  people.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  return NextResponse.json(people);
}
