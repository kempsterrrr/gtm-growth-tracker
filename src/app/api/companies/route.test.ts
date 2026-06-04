import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { CompanySummary } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-companies-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { todayIso } = await import("@/lib/dates");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const addCompany = (name: string) => {
  sqlite.prepare("INSERT INTO companies (name, domain) VALUES (?, ?)").run(name, `${name}.io`);
  return (sqlite.prepare("SELECT id FROM companies WHERE name = ?").get(name) as { id: number }).id;
};
const today = todayIso();
const aggregate = (companyId: number, scope: string, score: number, lastEvent: string | null = null) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count, star_count, fork_count, issue_count, pr_count, commit_count, last_event_date) VALUES (?, NULL, ?, ?, ?, 2, 1, 0, 1, 0, 0, ?)"
    )
    .run(companyId, scope, today, score, lastEvent);

const engagedCo = addCompany("engaged-co");
aggregate(engagedCo, "own", 30);

const battlegroundCo = addCompany("battleground-co");
aggregate(battlegroundCo, "own", 20, "2026-06-01");
aggregate(battlegroundCo, "competitor", 15, "2026-05-20");

const prospectCo = addCompany("prospect-co");
aggregate(prospectCo, "competitor", 25);

describe("GET /api/companies (seeded temp DB)", () => {
  it("returns dual scores and derived segments, ordered by the stronger signal", async () => {
    const res = await GET(new NextRequest("http://localhost/api/companies"));
    const body = (await res.json()) as CompanySummary[];

    expect(res.status).toBe(200);
    expect(body.map((c) => c.name)).toEqual(["engaged-co", "prospect-co", "battleground-co"]);

    const byName = Object.fromEntries(body.map((c) => [c.name, c]));
    expect(byName["engaged-co"]).toMatchObject({
      score: 30,
      competitorScore: 0,
      segment: "engaged",
    });
    expect(byName["battleground-co"]).toMatchObject({
      score: 20,
      competitorScore: 15,
      segment: "battleground",
      lastOwnEngagementAt: "2026-06-01",
      lastCompetitorEngagementAt: "2026-05-20",
    });
    expect(byName["prospect-co"].lastOwnEngagementAt).toBeNull();
    expect(byName["prospect-co"]).toMatchObject({
      score: 0,
      competitorScore: 25,
      segment: "prospect",
    });

    // exactly the contract keys
    expect(Object.keys(body[0]).sort()).toEqual(
      [
        "id",
        "name",
        "domain",
        "website",
        "industry",
        "employeeCount",
        "score",
        "competitorScore",
        "segment",
        "lastOwnEngagementAt",
        "lastCompetitorEngagementAt",
        "userCount",
        "starCount",
        "forkCount",
        "issueCount",
        "prCount",
        "commitCount",
        "scoreTrend",
      ].sort()
    );
  });

  it("minScore filters on the stronger of the two scores", async () => {
    const res = await GET(new NextRequest("http://localhost/api/companies?minScore=24"));
    const body = (await res.json()) as CompanySummary[];
    expect(body.map((c) => c.name)).toEqual(["engaged-co", "prospect-co"]);
  });
});
