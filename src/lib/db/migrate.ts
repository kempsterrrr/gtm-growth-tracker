import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "gtm-tracker.db");

export function runMigrations() {
  // Ensure the data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
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

    -- Seed default alert rules
    INSERT OR IGNORE INTO alert_rules (id, name, description, rule_type, config, enabled, notify_slack)
    VALUES
      (1, 'High-engagement company', 'Fires when a company reaches meaningful engagement from multiple people', 'score_threshold', '{"min_score":15,"min_users":2}', 1, 1),
      (2, 'Engagement spike', 'Fires when a company''s score doubles in a week', 'engagement_spike', '{"percent_increase":100,"window_days":7}', 1, 1);
  `);

  sqlite.close();
  console.log("Migrations complete.");
}
