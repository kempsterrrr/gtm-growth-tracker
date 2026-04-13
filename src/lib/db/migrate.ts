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
  `);

  sqlite.close();
  console.log("Migrations complete.");
}
