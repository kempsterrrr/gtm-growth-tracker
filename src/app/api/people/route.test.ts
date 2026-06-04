import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { PersonSummary } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-people-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);

run("INSERT INTO tracked_repos (owner, name, display_name) VALUES ('us', 'own-repo', 'Ours')");
run("INSERT INTO tracked_repos (owner, name, competitor) VALUES ('pinata', 'pinata-sdk', 'Pinata')");
const ownRepo = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='own-repo'").get() as { id: number }
).id;
const rivalRepo = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='pinata-sdk'").get() as { id: number }
).id;

// 1) An employed, engaged human — primary company + events on both sides.
run("INSERT INTO github_users (login, name) VALUES ('busy-dev', 'Busy Dev')");
const busyDev = (
  sqlite.prepare("SELECT id FROM github_users WHERE login='busy-dev'").get() as { id: number }
).id;
run("INSERT INTO companies (name, domain) VALUES ('Acme', 'acme.dev')");
const acme = (sqlite.prepare("SELECT id FROM companies WHERE name='Acme'").get() as { id: number })
  .id;
run(
  "INSERT INTO github_user_companies (user_id, company_id, source, is_primary) VALUES (?, ?, 'email_domain', 1)",
  busyDev,
  acme
);
const event = (repoId: number, userId: number, type: string, eventId: string, date: string) =>
  run(
    "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id, event_date) VALUES (?, ?, ?, ?, ?)",
    repoId,
    userId,
    type,
    eventId,
    date
  );
event(ownRepo, busyDev, "issue", "i-1", "2026-06-01");
event(rivalRepo, busyDev, "star", "star", "2026-05-01");

// 2) A tagged competitor employee with no company links.
run(
  "INSERT INTO github_users (login, competitor_employee, competitor_employee_source) VALUES ('rival-eng', 'Pinata', 'commit_activity')"
);
const rivalEng = (
  sqlite.prepare("SELECT id FROM github_users WHERE login='rival-eng'").get() as { id: number }
).id;
event(rivalRepo, rivalEng, "commit", "sha-1", "2026-06-02");

// 3) An enriched-but-never-engaged user — must not appear.
run("INSERT INTO github_users (login) VALUES ('lurker')");

describe("GET /api/people (seeded temp DB)", () => {
  it("returns every engaged human once with primary company, badges, and per-entity lines", async () => {
    const res = await GET();
    const body = (await res.json()) as PersonSummary[];

    expect(res.status).toBe(200);
    expect(body.map((p) => p.login)).toEqual(["rival-eng", "busy-dev"]); // freshest first

    const busy = body.find((p) => p.login === "busy-dev")!;
    expect(busy.primaryCompany).toEqual({ id: acme, name: "Acme", source: "email_domain" });
    expect(busy.lastActive).toBe("2026-06-01");
    expect(busy.engagements.map((e) => e.entity)).toEqual(["us/own-repo", "pinata/pinata-sdk"]);
    expect(busy.engagements[1].competitor).toBe("Pinata");

    const rival = body.find((p) => p.login === "rival-eng")!;
    expect(rival.primaryCompany).toBeNull();
    expect(rival.competitorEmployee).toBe("Pinata");
    expect(rival.lastActive).toBe("2026-06-02");

    // exactly the contract keys
    expect(Object.keys(busy).sort()).toEqual(
      [
        "id",
        "login",
        "name",
        "avatarUrl",
        "primaryCompany",
        "competitorEmployee",
        "competitorEmployeeSource",
        "engagements",
        "lastActive",
      ].sort()
    );
  });
});
