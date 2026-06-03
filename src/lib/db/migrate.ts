import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";

/**
 * Applies the drizzle-kit generated migrations in ./drizzle.
 *
 * Single-source cutover: the schema used to be authored twice (Drizzle
 * definitions + a hand-written SQL block here). src/lib/db/schema.ts is now
 * the single source of truth; migrations are generated from it with
 * `npx drizzle-kit generate`.
 *
 * Baseline strategy for pre-cutover databases: drizzle/0000_baseline.sql is
 * hand-edited to be idempotent (CREATE ... IF NOT EXISTS), so on a database
 * that already has every table it applies as a no-op and is then recorded by
 * the migrator; on a fresh database it creates the full schema. Migrations
 * AFTER the baseline are generated plain and must not be hand-edited.
 *
 * Default alert-rule seeding moved to the `seed-defaults` pipeline step
 * (src/lib/db/seed-defaults.ts) — migrations are pure DDL.
 */
export function runMigrations() {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "gtm-tracker.db");

  // Ensure the data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  sqlite.close();
  console.log("Migrations complete.");
}
