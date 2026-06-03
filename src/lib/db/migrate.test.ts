import { describe, it, expect } from "vitest";
import { mkdtempSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

const tmp = mkdtempSync(path.join(tmpdir(), "gtm-migrate-test-"));
// runMigrations resolves DATABASE_PATH at call time, so a static import is
// fine and the env var is set per test.
const { runMigrations } = await import("./migrate");

/** Frozen copy of the pre-cutover hand-written DDL (no seed data). */
const LEGACY_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS tracked_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner, name)
    );

    CREATE TABLE IF NOT EXISTS tracked_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registry TEXT NOT NULL CHECK(registry IN ('npm', 'pypi')),
      name TEXT NOT NULL,
      repo_id INTEGER REFERENCES tracked_repos(id),
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(registry, name)
    );

    CREATE TABLE IF NOT EXISTS github_repo_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES tracked_repos(id),
      date TEXT NOT NULL,
      stars INTEGER,
      forks INTEGER,
      watchers INTEGER,
      open_issues INTEGER,
      contributors INTEGER,
      collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, date)
    );

    CREATE TABLE IF NOT EXISTS github_traffic_clones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES tracked_repos(id),
      date TEXT NOT NULL,
      clones_total INTEGER NOT NULL,
      clones_unique INTEGER NOT NULL,
      UNIQUE(repo_id, date)
    );

    CREATE TABLE IF NOT EXISTS github_traffic_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES tracked_repos(id),
      date TEXT NOT NULL,
      views_total INTEGER NOT NULL,
      views_unique INTEGER NOT NULL,
      UNIQUE(repo_id, date)
    );

    CREATE TABLE IF NOT EXISTS npm_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL REFERENCES tracked_packages(id),
      date TEXT NOT NULL,
      downloads INTEGER NOT NULL,
      UNIQUE(package_id, date)
    );

    CREATE TABLE IF NOT EXISTS pypi_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL REFERENCES tracked_packages(id),
      date TEXT NOT NULL,
      downloads INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'overall',
      category_value TEXT,
      UNIQUE(package_id, date, category, category_value)
    );

    CREATE TABLE IF NOT EXISTS reverse_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL REFERENCES tracked_packages(id),
      dependent_name TEXT NOT NULL,
      dependent_registry TEXT NOT NULL,
      dependent_version TEXT,
      first_seen TEXT NOT NULL,
      UNIQUE(package_id, dependent_name, dependent_registry)
    );

    CREATE TABLE IF NOT EXISTS reverse_dependency_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL REFERENCES tracked_packages(id),
      date TEXT NOT NULL,
      count INTEGER NOT NULL,
      UNIQUE(package_id, date)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL CHECK(category IN ('release', 'dependency_added', 'blog_post', 'conference', 'upstream_inclusion', 'custom')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('auto', 'manual')),
      repo_id INTEGER REFERENCES tracked_repos(id),
      package_id INTEGER REFERENCES tracked_packages(id),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_github_repo_metrics_date ON github_repo_metrics(repo_id, date);
    CREATE INDEX IF NOT EXISTS idx_github_traffic_clones_date ON github_traffic_clones(repo_id, date);
    CREATE INDEX IF NOT EXISTS idx_github_traffic_views_date ON github_traffic_views(repo_id, date);
    CREATE INDEX IF NOT EXISTS idx_npm_downloads_date ON npm_downloads(package_id, date);
    CREATE INDEX IF NOT EXISTS idx_pypi_downloads_date ON pypi_downloads(package_id, date);
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
    CREATE INDEX IF NOT EXISTS idx_reverse_dep_counts_date ON reverse_dependency_counts(package_id, date);

    -- Sales Intelligence Tables

    CREATE TABLE IF NOT EXISTS github_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      github_id INTEGER,
      name TEXT,
      email TEXT,
      company_raw TEXT,
      bio TEXT,
      blog TEXT,
      avatar_url TEXT,
      location TEXT,
      twitter_username TEXT,
      enriched_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS github_user_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES github_users(id),
      email TEXT NOT NULL,
      domain TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'commit' CHECK(source IN ('commit', 'profile')),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS github_user_orgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES github_users(id),
      org_login TEXT NOT NULL,
      org_name TEXT,
      org_description TEXT,
      org_website TEXT,
      UNIQUE(user_id, org_login)
    );

    CREATE TABLE IF NOT EXISTS github_engagement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES tracked_repos(id),
      user_id INTEGER NOT NULL REFERENCES github_users(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('star', 'fork', 'issue', 'pr', 'commit', 'issue_comment', 'pr_review')),
      event_date TEXT,
      github_event_id TEXT,
      metadata TEXT,
      collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, user_id, event_type, github_event_id)
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT UNIQUE,
      website TEXT,
      industry TEXT,
      employee_count TEXT,
      funding_stage TEXT,
      description TEXT,
      logo_url TEXT,
      apollo_id TEXT,
      enriched_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS github_user_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES github_users(id),
      company_id INTEGER NOT NULL REFERENCES companies(id),
      source TEXT NOT NULL CHECK(source IN ('email_domain', 'profile_company', 'org_membership', 'manual')),
      confidence REAL NOT NULL DEFAULT 0.5,
      UNIQUE(user_id, company_id)
    );

    CREATE TABLE IF NOT EXISTS company_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      repo_id INTEGER REFERENCES tracked_repos(id),
      date TEXT NOT NULL,
      score REAL NOT NULL,
      user_count INTEGER NOT NULL,
      star_count INTEGER NOT NULL DEFAULT 0,
      fork_count INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      pr_count INTEGER NOT NULL DEFAULT 0,
      commit_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(company_id, repo_id, date)
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      rule_type TEXT NOT NULL CHECK(rule_type IN ('score_threshold', 'new_company', 'engagement_spike', 'new_enterprise_user')),
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_slack INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL REFERENCES alert_rules(id),
      company_id INTEGER REFERENCES companies(id),
      user_id INTEGER REFERENCES github_users(id),
      title TEXT NOT NULL,
      detail TEXT,
      metadata TEXT,
      slack_sent INTEGER NOT NULL DEFAULT 0,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      fired_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS slack_config (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
      webhook_url TEXT,
      channel_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enrichment_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_login TEXT NOT NULL UNIQUE,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collection_cursors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cursor_type TEXT NOT NULL,
      repo_id INTEGER NOT NULL REFERENCES tracked_repos(id),
      cursor_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cursor_type, repo_id)
    );

    CREATE INDEX IF NOT EXISTS idx_engagement_events_repo_user ON github_engagement_events(repo_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_engagement_events_user ON github_engagement_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_company_scores_date ON company_scores(company_id, date);
    CREATE INDEX IF NOT EXISTS idx_alert_events_fired ON alert_events(fired_at);
    CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status ON enrichment_queue(status, priority);

    -- Pipeline run records

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES pipeline_runs(id),
      step_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'skipped')),
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      UNIQUE(run_id, step_name)
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run ON pipeline_run_steps(run_id);
`;

// ── Schema normalisation ────────────────────────────────────────────────

interface TableSnapshot {
  columns: Array<{ name: string; type: string; notnull: number; dflt: string | null; pk: number }>;
  uniques: string[];
  indexes: string[];
  checks: string[];
  fks: string[];
  autoincrement: boolean;
}

type Db = InstanceType<typeof Database>;

function normalizeExpr(s: string): string {
  // Strip identifier quoting and any table-name qualification, collapse whitespace.
  return s
    .replace(/[`"]/g, "")
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\.(?=[A-Za-z_])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChecks(createSql: string): string[] {
  // Balanced-paren scan: find every CHECK( ... ) including nested parens.
  const checks: string[] = [];
  const re = /CHECK\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(createSql))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < createSql.length && depth > 0) {
      if (createSql[i] === "(") depth++;
      else if (createSql[i] === ")") depth--;
      i++;
    }
    checks.push(normalizeExpr(createSql.slice(start, i - 1)));
  }
  return checks.sort();
}

function snapshot(db: Db): Record<string, TableSnapshot> {
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
    )
    .all() as Array<{ name: string; sql: string }>;
  const out: Record<string, TableSnapshot> = {};
  for (const t of tables) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const cols = (db.prepare(`PRAGMA table_info(${t.name})`).all() as any[]).map((c) => ({
      name: c.name as string,
      type: String(c.type).toUpperCase(),
      // INTEGER PRIMARY KEY is implicitly not-null; normalise the flag
      notnull: c.pk ? 1 : (c.notnull as number),
      dflt:
        c.dflt_value === null
          ? null
          : normalizeExpr(String(c.dflt_value)).replace(/^\((.*)\)$/, "$1"),
      pk: c.pk as number,
    }));
    const idxList = db.prepare(`PRAGMA index_list(${t.name})`).all() as any[];
    const uniques: string[] = [];
    const indexes: string[] = [];
    for (const idx of idxList) {
      const colNames = (db.prepare(`PRAGMA index_info(${idx.name})`).all() as any[])
        .sort((a, b) => a.seqno - b.seqno)
        .map((c) => c.name)
        .join(",");
      if (idx.unique) uniques.push(colNames);
      else indexes.push(`${idx.name}(${colNames})`);
    }
    const fks = (db.prepare(`PRAGMA foreign_key_list(${t.name})`).all() as any[])
      .map((f) => `${f.from}->${f.table}.${f.to}`)
      .sort();
    /* eslint-enable @typescript-eslint/no-explicit-any */
    out[t.name] = {
      columns: cols,
      // Autoindex (legacy inline UNIQUE) and named unique index (generated)
      // are equivalent representations — dedupe by column tuple.
      uniques: [...new Set(uniques)].sort(),
      indexes: indexes.sort(),
      checks: extractChecks(t.sql),
      fks,
      autoincrement: /AUTOINCREMENT/i.test(t.sql),
    };
  }
  return out;
}

function rowCounts(db: Db): Record<string, number> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'"
    )
    .all() as Array<{ name: string }>;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    counts[t.name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number }).n;
  }
  return counts;
}

describe("schema equivalence (upgrade-path gate)", () => {
  // The original cutover gate compared a fresh generated DB against the
  // frozen legacy DDL — impossible to satisfy once post-cutover migrations
  // exist. The evolved gate asserts both provisioning paths converge: a
  // legacy pre-cutover DB upgraded by the migrator (idempotent baseline +
  // later migrations) must equal a freshly migrated DB.
  it("a legacy DB upgraded by the migrator matches a fresh generated DB", () => {
    const legacyPath = path.join(tmp, "legacy.db");
    const legacyDb = new Database(legacyPath);
    legacyDb.exec(LEGACY_SCHEMA_SQL);
    legacyDb.close();
    process.env.DATABASE_PATH = legacyPath;
    runMigrations();

    const genPath = path.join(tmp, "generated.db");
    process.env.DATABASE_PATH = genPath;
    runMigrations();

    const upgradedDb = new Database(legacyPath);
    const genDb = new Database(genPath);
    expect(snapshot(genDb)).toEqual(snapshot(upgradedDb));
    genDb.close();
    upgradedDb.close();
  });

  it("the migrations add the nullable competitor attribution columns", () => {
    process.env.DATABASE_PATH = path.join(tmp, "columns.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const competitorCol = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>)
        .filter((c) => c.name === "competitor")
        .map((c) => ({ name: c.name, notnull: c.notnull }));
    expect(competitorCol("tracked_repos")).toEqual([{ name: "competitor", notnull: 0 }]);
    expect(competitorCol("tracked_packages")).toEqual([{ name: "competitor", notnull: 0 }]);
    db.close();
  });

  it("the migrations add the scoped company-score column", () => {
    process.env.DATABASE_PATH = path.join(tmp, "columns-scope.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const col = (
      db.prepare("PRAGMA table_info(company_scores)").all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>
    )
      .filter((c) => c.name === "scope")
      .map((c) => ({ name: c.name, notnull: c.notnull, dflt: c.dflt_value }));
    expect(col).toEqual([{ name: "scope", notnull: 1, dflt: "'own'" }]);
    db.close();
  });

  it("the migrations add the competitor-signals table", () => {
    process.env.DATABASE_PATH = path.join(tmp, "signals.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const cols = (
      db.prepare("PRAGMA table_info(company_competitor_signals)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual([
      "id",
      "company_id",
      "package_id",
      "signal_type",
      "dependent_name",
      "first_seen",
    ]);
    db.close();
  });

  it("the migrations add the competitor-employee tagging columns", () => {
    process.env.DATABASE_PATH = path.join(tmp, "employee-tags.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const cols = (
      db.prepare("PRAGMA table_info(github_users)").all() as Array<{
        name: string;
        notnull: number;
      }>
    )
      .filter((c) => c.name.startsWith("competitor_employee"))
      .map((c) => ({ name: c.name, notnull: c.notnull }));
    expect(cols).toEqual([
      { name: "competitor_employee", notnull: 0 },
      { name: "competitor_employee_source", notnull: 0 },
    ]);
    db.close();
  });
});

describe("live-data migration (hard gate)", () => {
  it("applies to a copy of the committed production DB without error or data loss", () => {
    const committed = path.join(process.cwd(), "data", "gtm-tracker.db");
    const copy = path.join(tmp, "live.db");
    copyFileSync(committed, copy);

    const beforeDb = new Database(copy, { readonly: true });
    const before = rowCounts(beforeDb);
    beforeDb.close();
    expect(Object.keys(before).length).toBeGreaterThan(20); // sanity: real DB

    process.env.DATABASE_PATH = copy;
    runMigrations();

    const db = new Database(copy);
    const after = rowCounts(db);
    // No data loss: every pre-existing table keeps every row. Tables ADDED
    // by migrations are allowed — but must start empty (pure DDL).
    for (const [table, n] of Object.entries(before)) {
      expect(after[table], table).toBe(n);
    }
    for (const [table, n] of Object.entries(after)) {
      if (!(table in before)) expect(n, `${table} should start empty`).toBe(0);
    }
    const applied = db.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as {
      n: number;
    };
    expect(applied.n).toBeGreaterThan(0);
    db.close();
  });
});
