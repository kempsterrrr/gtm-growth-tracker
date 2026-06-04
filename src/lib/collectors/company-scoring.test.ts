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
const { todayIso, daysAgoIso } = await import("../dates");

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
  "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
  u1,
  companyId
);
run(
  "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
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

  it("excludes tagged competitor employees from competitor aggregation but keeps their own-side engagement", async () => {
    // u3: issue on the competitor repo (would add 8 + breadth) AND a star on
    // ours (adds 1) — tagged as a Pinata employee.
    run("INSERT INTO github_users (login, competitor_employee, competitor_employee_source) VALUES ('u3', 'Acme', 'commit_activity')");
    const u3 = (sqlite.prepare("SELECT id FROM github_users WHERE login='u3'").get() as { id: number }).id;
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
      u3,
      companyId
    );
    event(rivalRepoId, u3, "issue", "issue-77");
    event(ownRepoId, u3, "star", "star-u3");

    await scoreCompanies();
    const today = todayIso();
    const aggregate = (scope: string) =>
      (
        sqlite
          .prepare(
            "SELECT score FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND scope = ? AND date = ?"
          )
          .get(companyId, scope, today) as { score: number }
      ).score;

    expect(aggregate("competitor")).toBe(34); // unchanged — u3's competitor issue excluded
    expect(aggregate("own")).toBe(21); // 18 + u3's star (1) + breadth for a 3rd user (2)
  });

  it("decays engagement by age on both scopes; depends-on keeps full weight forever", async () => {
    // Fresh company with precisely-aged events: ages at exact half-life
    // multiples make the decayed contributions exact.
    run("INSERT INTO companies (name, domain) VALUES ('Recencio', 'recencio.io')");
    const recencio = (
      sqlite.prepare("SELECT id FROM companies WHERE name='Recencio'").get() as { id: number }
    ).id;
    run("INSERT INTO github_users (login) VALUES ('u4')");
    const u4 = (
      sqlite.prepare("SELECT id FROM github_users WHERE login='u4'").get() as { id: number }
    ).id;
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
      u4,
      recencio
    );
    const datedEvent = (repoId: number, userId: number, type: string, eventId: string, date: string) =>
      run(
        "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id, event_date) VALUES (?, ?, ?, ?, ?)",
        repoId,
        userId,
        type,
        eventId,
        date
      );
    datedEvent(rivalRepoId, u4, "issue", "issue-old", daysAgoIso(90)); // one half-life: 8 × 0.5 = 4
    datedEvent(ownRepoId, u4, "star", "star-older", daysAgoIso(180)); // two half-lives: 1 × 0.25 = 0.25
    // Depends-on from two years ago — a dependency is current state, undecayed.
    run(
      "INSERT INTO company_competitor_signals (company_id, package_id, signal_type, dependent_name, first_seen) VALUES (?, ?, 'depends_on', 'recencio-app', ?)",
      recencio,
      rivalPkgId,
      daysAgoIso(700)
    );

    await scoreCompanies();
    const agg = (scope: string) =>
      sqlite
        .prepare(
          "SELECT score FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND scope = ? AND date = ?"
        )
        .get(recencio, scope, todayIso()) as { score: number } | undefined;

    expect(agg("competitor")?.score).toBe(18); // 4 decayed issue + 2 breadth + 12 undecayed signal
    expect(agg("own")?.score).toBe(2.25); // 0.25 decayed star + 2 breadth
  });

  it("stamps each aggregate with the newest event date it kept, per scope", async () => {
    await scoreCompanies();
    const stamp = (companyId: number, scope: string) =>
      (
        sqlite
          .prepare(
            "SELECT last_event_date AS d FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND scope = ? AND date = ?"
          )
          .get(companyId, scope, todayIso()) as { d: string | null } | undefined
      )?.d;

    const recencio = (
      sqlite.prepare("SELECT id FROM companies WHERE name='Recencio'").get() as { id: number }
    ).id;
    expect(stamp(recencio, "competitor")).toBe(daysAgoIso(90)); // its only competitor event
    expect(stamp(recencio, "own")).toBe(daysAgoIso(180));
    // Globex's events are dateless → they stamp from their collection date (today)
    expect(stamp(companyId, "own")).toBe(todayIso());
    expect(stamp(companyId, "competitor")).toBe(todayIso());
  });

  it("skips events past the max age entirely — fully-cooled companies carry no aggregate", async () => {
    run("INSERT INTO companies (name, domain) VALUES ('Ancient Ltd', 'ancient.io')");
    const ancient = (
      sqlite.prepare("SELECT id FROM companies WHERE name='Ancient Ltd'").get() as { id: number }
    ).id;
    run("INSERT INTO github_users (login) VALUES ('u5')");
    const u5 = (
      sqlite.prepare("SELECT id FROM github_users WHERE login='u5'").get() as { id: number }
    ).id;
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
      u5,
      ancient
    );
    run(
      "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id, event_date) VALUES (?, ?, 'issue', 'issue-ancient', ?)",
      rivalRepoId,
      u5,
      daysAgoIso(400)
    );

    await scoreCompanies();
    const rows = sqlite
      .prepare("SELECT scope FROM company_scores WHERE company_id = ? AND repo_id IS NULL")
      .all(ancient) as Array<{ scope: string }>;
    expect(rows).toEqual([]); // 400d-old issue contributes nothing; no breadth; no row
  });

  it("counts a user only at their primary company (PRD #42)", async () => {
    run("INSERT INTO companies (name, domain) VALUES ('PrimaryCo', 'primaryco.io')");
    run("INSERT INTO companies (name, domain) VALUES ('OrgNoiseCo', 'orgnoise.io')");
    const primaryCo = (
      sqlite.prepare("SELECT id FROM companies WHERE name='PrimaryCo'").get() as { id: number }
    ).id;
    const orgNoiseCo = (
      sqlite.prepare("SELECT id FROM companies WHERE name='OrgNoiseCo'").get() as { id: number }
    ).id;
    run("INSERT INTO github_users (login) VALUES ('shared-dev')");
    const sharedDev = (
      sqlite.prepare("SELECT id FROM github_users WHERE login='shared-dev'").get() as { id: number }
    ).id;
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
      sharedDev,
      primaryCo
    );
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'org_membership', 0)",
      sharedDev,
      orgNoiseCo
    );
    event(ownRepoId, sharedDev, "issue", "issue-shared");

    await scoreCompanies();
    const aggFor = (companyId: number) =>
      sqlite
        .prepare("SELECT scope FROM company_scores WHERE company_id = ? AND repo_id IS NULL")
        .all(companyId) as Array<{ scope: string }>;

    expect(aggFor(primaryCo).map((r) => r.scope)).toEqual(["own"]); // counted once, here
    expect(aggFor(orgNoiseCo)).toEqual([]); // the org link contributes nothing
  });

  it("never writes a competitor aggregate for the competitor's own company", async () => {
    // A company named after the tracked competitor, with real engagement on
    // the competitor repo — it must not rank as its own prospect.
    run("INSERT INTO companies (name, domain) VALUES ('Acme', 'acme.dev')");
    const acmeId = (
      sqlite.prepare("SELECT id FROM companies WHERE name='Acme'").get() as { id: number }
    ).id;
    run("INSERT INTO github_users (login) VALUES ('acme-fan')");
    const fan = (
      sqlite.prepare("SELECT id FROM github_users WHERE login='acme-fan'").get() as { id: number }
    ).id;
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
      fan,
      acmeId
    );
    event(rivalRepoId, fan, "issue", "issue-acme");

    await scoreCompanies();
    const rows = sqlite
      .prepare(
        "SELECT scope FROM company_scores WHERE company_id = ? AND repo_id IS NULL"
      )
      .all(acmeId) as Array<{ scope: string }>;
    expect(rows).toEqual([]); // no competitor aggregate → never a prospect
  });
});
