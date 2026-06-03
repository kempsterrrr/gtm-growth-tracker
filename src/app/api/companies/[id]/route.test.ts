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

// Depends-on signals on a competitor package: 2 dependents → score 24 row.
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'pinata-js', 'Pinata JS', 'Pinata')"
  )
  .run();
const rivalPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='pinata-js'").get() as { id: number }
).id;
sqlite
  .prepare(
    "INSERT INTO company_competitor_signals (company_id, package_id, signal_type, dependent_name, first_seen) VALUES (?, ?, 'depends_on', 'acme-app', '2026-06-01'), (?, ?, 'depends_on', 'acme-cli', '2026-06-01')"
  )
  .run(companyId, rivalPkgId, companyId, rivalPkgId);

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

  it("attributes the competitor score to its sources (repos + package dependents, score desc)", async () => {
    const res = await request(companyId);
    const body = (await res.json()) as CompanyDetail;
    expect(body.competitorAttribution).toEqual([
      {
        competitor: "Pinata",
        entity: "pinata-js",
        displayName: "Pinata JS",
        signal: "depends_on",
        dependentCount: 2,
        score: 24,
        userCount: 0,
        starCount: 0,
        forkCount: 0,
        issueCount: 0,
        prCount: 0,
        commitCount: 0,
      },
      {
        competitor: "Pinata",
        entity: "pinata/pinata-sdk",
        displayName: "Pinata SDK",
        signal: "engagement",
        dependentCount: 0,
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
