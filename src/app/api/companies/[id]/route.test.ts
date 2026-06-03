import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { CompanyDetail } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-company-detail-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { todayIso, daysAgoIso } = await import("@/lib/dates");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Globex', 'globex.com')").run();
const companyId = (
  sqlite.prepare("SELECT id FROM companies WHERE name='Globex'").get() as { id: number }
).id;

const aggregate = (scope: string, date: string, score: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count) VALUES (?, NULL, ?, ?, ?, 2)"
    )
    .run(companyId, scope, date, score);

aggregate("own", daysAgoIso(3), 12);
aggregate("own", todayIso(), 20);
aggregate("competitor", todayIso(), 15);

// Per-repo competitor attribution rows: two dates for the same repo — the
// route must return only the latest.
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, display_name, competitor) VALUES ('pinata', 'pinata-sdk', 'Pinata SDK', 'Pinata')"
  )
  .run();
const rivalRepoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='pinata-sdk'").get() as { id: number }
).id;
const repoScore = (date: string, score: number, issues: number, forks: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count, star_count, fork_count, issue_count, pr_count, commit_count) VALUES (?, ?, 'competitor', ?, ?, 1, 0, ?, ?, 0, 0)"
    )
    .run(companyId, rivalRepoId, date, score, forks, issues);
repoScore(daysAgoIso(3), 8, 2, 1);
repoScore(todayIso(), 14, 4, 2);

const request = (id: number) =>
  GET(new NextRequest(`http://localhost/api/companies/${id}`), {
    params: Promise.resolve({ id: String(id) }),
  });

describe("GET /api/companies/[id] (seeded temp DB)", () => {
  it("carries dual scores, segment, and an own-only score history", async () => {
    const res = await request(companyId);
    const body = (await res.json()) as CompanyDetail;

    expect(res.status).toBe(200);
    expect(body.score).toBe(20);
    expect(body.competitorScore).toBe(15);
    expect(body.segment).toBe("battleground");
    // competitor aggregates must NOT leak into the own-score history chart
    expect(body.scoreHistory).toEqual([
      { date: daysAgoIso(3), score: 12 },
      { date: todayIso(), score: 20 },
    ]);
  });

  it("404s for an unknown company", async () => {
    const res = await request(99999);
    expect(res.status).toBe(404);
  });

  it("attributes the competitor score to its source repos (latest row per repo)", async () => {
    const res = await request(companyId);
    const body = (await res.json()) as CompanyDetail;
    expect(body.competitorAttribution).toEqual([
      {
        competitor: "Pinata",
        entity: "pinata/pinata-sdk",
        displayName: "Pinata SDK",
        score: 14,
        userCount: 1,
        starCount: 0,
        forkCount: 2,
        issueCount: 4,
        prCount: 0,
        commitCount: 0,
      },
    ]);
  });
});
