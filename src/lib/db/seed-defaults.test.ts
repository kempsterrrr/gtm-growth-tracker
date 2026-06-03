import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-seed-test-")),
  "test.db"
);

const { runMigrations } = await import("./migrate");
const { seedDefaults } = await import("./seed-defaults");

runMigrations();

describe("seedDefaults", () => {
  it("idempotently seeds the five default rules including the competitor trio", () => {
    seedDefaults();
    seedDefaults();

    const sqlite = new Database(process.env.DATABASE_PATH!);
    const rules = sqlite
      .prepare("SELECT id, rule_type, config, enabled FROM alert_rules ORDER BY id")
      .all() as Array<{ id: number; rule_type: string; config: string; enabled: number }>;

    expect(rules).toHaveLength(5);
    expect(rules.map((r) => r.rule_type)).toEqual([
      "score_threshold",
      "engagement_spike",
      "new_prospect",
      "battleground_shift",
      "competitor_employee_engagement",
    ]);
    expect(JSON.parse(rules[2].config)).toEqual({ min_score: 20 });
    expect(JSON.parse(rules[3].config)).toEqual({});
    expect(JSON.parse(rules[4].config)).toEqual({ window_days: 7 });
    expect(rules.every((r) => r.enabled === 1)).toBe(true);
    sqlite.close();
  });
});
