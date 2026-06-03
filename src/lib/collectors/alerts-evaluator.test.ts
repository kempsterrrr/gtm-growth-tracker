import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-alerts-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { evaluateAlerts } = await import("./alerts-evaluator");
const { todayIso } = await import("../dates");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    `INSERT INTO alert_rules (name, rule_type, config, enabled, notify_slack)
     VALUES ('hot', 'score_threshold', '{"min_score":15,"min_users":1}', 1, 0)`
  )
  .run();
sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Rivalfan', 'rivalfan.io')").run();
sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Hotlead', 'hotlead.io')").run();
const rivalfan = (
  sqlite.prepare("SELECT id FROM companies WHERE name='Rivalfan'").get() as { id: number }
).id;
const hotlead = (
  sqlite.prepare("SELECT id FROM companies WHERE name='Hotlead'").get() as { id: number }
).id;

const today = todayIso();
const score = (companyId: number, scope: string, value: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count) VALUES (?, NULL, ?, ?, ?, 3)"
    )
    .run(companyId, scope, today, value);

// Rivalfan: prospect — big COMPETITOR score, tiny own. Must NOT fire an
// own-engagement alert (competitor rule types are #24's work).
score(rivalfan, "competitor", 80);
score(rivalfan, "own", 4);
// Hotlead: genuinely hot on OUR repos → fires.
score(hotlead, "own", 40);

describe("evaluateAlerts with scoped aggregates", () => {
  it("score_threshold reads own-scope aggregates only", async () => {
    await evaluateAlerts();
    const alerts = sqlite
      .prepare("SELECT company_id FROM alert_events ORDER BY company_id")
      .all() as Array<{ company_id: number }>;
    expect(alerts.map((a) => a.company_id)).toEqual([hotlead]);
  });
});
