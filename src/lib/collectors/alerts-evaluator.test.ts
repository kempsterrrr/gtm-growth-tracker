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
const { todayIso, daysAgoIso } = await import("../dates");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    `INSERT INTO alert_rules (name, rule_type, config, enabled, notify_slack)
     VALUES ('hot', 'score_threshold', '{"min_score":15,"min_users":1}', 1, 0)`
  )
  .run();
const addRule = (name: string, type: string, config: string) => {
  sqlite
    .prepare(
      "INSERT INTO alert_rules (name, rule_type, config, enabled, notify_slack) VALUES (?, ?, ?, 1, 0)"
    )
    .run(name, type, config);
  return (sqlite.prepare("SELECT id FROM alert_rules WHERE name = ?").get(name) as { id: number })
    .id;
};
const prospectRule = addRule("new prospect", "new_prospect", '{"min_score":20}');
const shiftRule = addRule("battleground shift", "battleground_shift", "{}");
const employeeRule = addRule(
  "employee engagement",
  "competitor_employee_engagement",
  '{"window_days":7}'
);
const alertsFor = (ruleId: number) =>
  sqlite
    .prepare(
      "SELECT company_id, user_id, title, detail FROM alert_events WHERE rule_id = ? ORDER BY id"
    )
    .all(ruleId) as Array<{
    company_id: number | null;
    user_id: number | null;
    title: string;
    detail: string | null;
  }>;
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
      .prepare("SELECT company_id FROM alert_events WHERE rule_id = 1 ORDER BY company_id")
      .all() as Array<{ company_id: number }>;
    expect(alerts.map((a) => a.company_id)).toEqual([hotlead]);
  });
});

describe("competitor alert rules", () => {
  // ── new_prospect ──────────────────────────────────────────────────────
  // A competitor-only company over threshold (with an attributable source);
  // Rivalfan (competitor 80 + own 4) must NOT fire — it has own engagement.
  sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Freshco', 'freshco.io')").run();
  const freshco = (
    sqlite.prepare("SELECT id FROM companies WHERE name='Freshco'").get() as { id: number }
  ).id;
  sqlite
    .prepare("INSERT INTO tracked_repos (owner, name, competitor) VALUES ('pinata', 'pinata-sdk', 'Pinata')")
    .run();
  const rivalRepo = (
    sqlite.prepare("SELECT id FROM tracked_repos WHERE name='pinata-sdk'").get() as { id: number }
  ).id;
  score(freshco, "competitor", 45);
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count) VALUES (?, ?, 'competitor', ?, 45, 2)"
    )
    .run(freshco, rivalRepo, today);

  it("new_prospect fires once for competitor-only companies over threshold, naming the competitor", async () => {
    await evaluateAlerts();
    await evaluateAlerts(); // debounce window — must stay at one

    const alerts = alertsFor(prospectRule);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].company_id).toBe(freshco);
    expect(alerts[0].title).toContain("Freshco");
    expect(alerts[0].detail).toContain("Pinata");
    expect(alerts[0].detail).toContain("45");
    // Rivalfan has own engagement → never a new prospect
    expect(alerts.some((a) => a.company_id === rivalfan)).toBe(false);
  });

  // ── battleground_shift ────────────────────────────────────────────────
  it("battleground_shift detects transitions from both directions, skipping steady state", async () => {
    const yesterday = daysAgoIso(1);
    const seed = (companyId: number, scope: string, date: string, value: number) =>
      sqlite
        .prepare(
          "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count) VALUES (?, NULL, ?, ?, ?, 1)"
        )
        .run(companyId, scope, date, value);
    const company = (name: string) => {
      sqlite.prepare("INSERT INTO companies (name, domain) VALUES (?, ?)").run(name, `${name}.io`);
      return (sqlite.prepare("SELECT id FROM companies WHERE name = ?").get(name) as { id: number })
        .id;
    };

    const wasEngaged = company("was-engaged"); // own → both: started engaging competitor
    seed(wasEngaged, "own", yesterday, 10);
    seed(wasEngaged, "own", today, 10);
    seed(wasEngaged, "competitor", today, 8);

    const wasProspect = company("was-prospect"); // competitor → both: started engaging us
    seed(wasProspect, "competitor", yesterday, 9);
    seed(wasProspect, "competitor", today, 9);
    seed(wasProspect, "own", today, 3);

    const steady = company("steady-battleground"); // both → both: silent
    seed(steady, "own", yesterday, 5);
    seed(steady, "competitor", yesterday, 5);
    seed(steady, "own", today, 6);
    seed(steady, "competitor", today, 6);

    await evaluateAlerts();
    await evaluateAlerts(); // debounced

    const alerts = alertsFor(shiftRule);
    expect(alerts.map((a) => a.company_id).sort()).toEqual([wasEngaged, wasProspect].sort());
    const byCompany = Object.fromEntries(alerts.map((a) => [a.company_id, a]));
    expect(byCompany[wasEngaged].detail).toContain("competitor");
    expect(byCompany[wasProspect].detail).toContain("our repos");
  });

  // ── competitor_employee_engagement ────────────────────────────────────
  it("employee engagement fires only for tagged users on our own repos", async () => {
    sqlite.prepare("INSERT INTO tracked_repos (owner, name) VALUES ('us', 'own-repo')").run();
    const ownRepo = (
      sqlite.prepare("SELECT id FROM tracked_repos WHERE name='own-repo'").get() as { id: number }
    ).id;
    const user = (login: string, tagged: boolean) => {
      sqlite
        .prepare(
          "INSERT INTO github_users (login, competitor_employee, competitor_employee_source) VALUES (?, ?, ?)"
        )
        .run(login, tagged ? "Pinata" : null, tagged ? "commit_activity" : null);
      return (
        sqlite.prepare("SELECT id FROM github_users WHERE login = ?").get(login) as { id: number }
      ).id;
    };
    const insider = user("insider", true);
    const fan = user("ordinary-fan", false);
    const lurker = user("competitor-lurker", true); // tagged but only active on the competitor repo

    const event = (repoId: number, userId: number, type: string, eventId: string) =>
      sqlite
        .prepare(
          "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id) VALUES (?, ?, ?, ?)"
        )
        .run(repoId, userId, type, eventId);
    event(ownRepo, insider, "star", "star-insider");
    event(ownRepo, fan, "star", "star-fan");
    event(rivalRepo, lurker, "commit", "sha-lurker");

    await evaluateAlerts();
    await evaluateAlerts(); // debounced

    const alerts = alertsFor(employeeRule);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].user_id).toBe(insider);
    expect(alerts[0].title).toContain("insider");
    expect(alerts[0].detail).toContain("Pinata");
    expect(alerts[0].detail).toContain("own-repo");
  });
});
