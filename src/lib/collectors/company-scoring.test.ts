import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-scoring-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { scoreCompanies } = await import("./company-scoring");
const { todayIso } = await import("../dates");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);

run("INSERT INTO tracked_repos (owner, name) VALUES ('us', 'own-repo')");
run("INSERT INTO tracked_repos (owner, name, competitor) VALUES ('them', 'rival-repo', 'Acme')");
const ownRepoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='own-repo'").get() as { id: number }
).id;
const rivalRepoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='rival-repo'").get() as { id: number }
).id;

run("INSERT INTO github_users (login) VALUES ('u1')");
run("INSERT INTO github_users (login) VALUES ('u2')");
const u1 = (sqlite.prepare("SELECT id FROM github_users WHERE login='u1'").get() as { id: number })
  .id;
const u2 = (sqlite.prepare("SELECT id FROM github_users WHERE login='u2'").get() as { id: number })
  .id;

run("INSERT INTO companies (name, domain) VALUES ('Globex', 'globex.com')");
const companyId = (
  sqlite.prepare("SELECT id FROM companies WHERE name='Globex'").get() as { id: number }
).id;
run(
  "INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')",
  u1,
  companyId
);
run(
  "INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')",
  u2,
  companyId
);

const event = (repoId: number, userId: number, type: string, eventId: string) =>
  run(
    "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id) VALUES (?, ?, ?, ?)",
    repoId,
    userId,
    type,
    eventId
  );

// Own repo: u1 star (1) + commit (10); u2 issue (3) → 2 users → 14 + 2*2 = 18
event(ownRepoId, u1, "star", "star");
event(ownRepoId, u1, "commit", "sha1");
event(ownRepoId, u2, "issue", "issue-1");
// Competitor repo: u1 issue (8); u2 commit (weight 0 → not a scoring user) → 8 + 1*2 = 10
event(rivalRepoId, u1, "issue", "issue-9");
event(rivalRepoId, u2, "commit", "sha2");

// Depends-on signals: 2 dependents on one competitor package → 2 × 12 = 24
// added to the competitor aggregate.
run("INSERT INTO tracked_packages (registry, name, competitor) VALUES ('npm', 'pinata-js', 'Acme')");
const rivalPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='pinata-js'").get() as { id: number }
).id;
const signal = (dependent: string) =>
  run(
    "INSERT INTO company_competitor_signals (company_id, package_id, signal_type, dependent_name, first_seen) VALUES (?, ?, 'depends_on', ?, '2026-06-01')",
    companyId,
    rivalPkgId,
    dependent
  );
signal("acme-app");
signal("acme-cli");

describe("scoreCompanies with competitor attribution", () => {
  it("applies the weight table per repo and writes scoped per-repo + aggregate rows", async () => {
    await scoreCompanies();
    const today = todayIso();

    const repoRow = (repoId: number) =>
      sqlite
        .prepare(
          "SELECT scope, score, user_count, commit_count FROM company_scores WHERE company_id = ? AND repo_id = ? AND date = ?"
        )
        .get(companyId, repoId, today) as {
        scope: string;
        score: number;
        user_count: number;
        commit_count: number;
      };

    const own = repoRow(ownRepoId);
    expect(own.scope).toBe("own");
    expect(own.score).toBe(18); // 1 + 10 + 3 + 2 users × 2 breadth — unchanged math
    expect(own.user_count).toBe(2);

    const rival = repoRow(rivalRepoId);
    expect(rival.scope).toBe("competitor");
    expect(rival.score).toBe(10); // issue 8 + 1 scoring user × 2; commit contributes 0
    expect(rival.user_count).toBe(1); // weight-0-only user doesn't count
    expect(rival.commit_count).toBe(1); // …but the fact is still recorded

    const aggregates = sqlite
      .prepare(
        "SELECT scope, score FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND date = ? ORDER BY scope"
      )
      .all(companyId, today) as Array<{ scope: string; score: number }>;
    expect(aggregates).toEqual([
      { scope: "competitor", score: 34 }, // 10 engagement + 2 dependents × 12
      { scope: "own", score: 18 },
    ]);
  });

  it("re-running the same day replaces aggregates instead of duplicating them", async () => {
    await scoreCompanies();
    await scoreCompanies();
    const count = (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND date = ?"
        )
        .get(companyId, todayIso()) as { n: number }
    ).n;
    expect(count).toBe(2); // exactly one own + one competitor — the NULL-repo dup bug is fixed
  });
});
