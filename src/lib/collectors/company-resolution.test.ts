import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-resolution-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { resolveCompanies } = await import("./company-resolution");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);

const user = (login: string) => {
  run("INSERT INTO github_users (login) VALUES (?)", login);
  return (sqlite.prepare("SELECT id FROM github_users WHERE login=?").get(login) as { id: number })
    .id;
};

// u1: a work email (0.9) AND two org memberships (0.6) — email must win primary.
const u1 = user("dev-with-email");
run(
  "INSERT INTO github_user_emails (user_id, email, domain, source) VALUES (?, 'dev@acme.dev', 'acme.dev', 'commit')",
  u1
);
run(
  "INSERT INTO github_user_orgs (user_id, org_login, org_name, org_website) VALUES (?, 'oss-club', 'OSS Club', 'https://ossclub.io')",
  u1
);
run(
  "INSERT INTO github_user_orgs (user_id, org_login, org_name, org_website) VALUES (?, 'meetup-org', 'Meetup Org', 'https://meetuporg.io')",
  u1
);

// u2: two org memberships only — equal confidence, first-discovered wins.
const u2 = user("org-only-dev");
run(
  "INSERT INTO github_user_orgs (user_id, org_login, org_name, org_website) VALUES (?, 'first-org', 'First Org', 'https://firstorg.io')",
  u2
);
run(
  "INSERT INTO github_user_orgs (user_id, org_login, org_name, org_website) VALUES (?, 'second-org', 'Second Org', 'https://secondorg.io')",
  u2
);

const primariesOf = (userId: number) =>
  sqlite
    .prepare(
      "SELECT c.domain AS domain, guc.source AS source, guc.is_primary AS p FROM github_user_companies guc JOIN companies c ON c.id = guc.company_id WHERE guc.user_id = ? ORDER BY guc.id"
    )
    .all(userId) as Array<{ domain: string | null; source: string; p: number }>;

describe("primary-company recompute (PRD #42)", () => {
  it("the highest-confidence link wins; org links survive as non-primary", async () => {
    await resolveCompanies();

    const u1Links = primariesOf(u1);
    expect(u1Links).toHaveLength(3);
    const primaries = u1Links.filter((l) => l.p === 1);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatchObject({ domain: "acme.dev", source: "email_domain" });
  });

  it("equal-confidence ties go to the first-discovered link", async () => {
    const u2Links = primariesOf(u2);
    expect(u2Links.filter((l) => l.p === 1)).toHaveLength(1);
    expect(u2Links[0].p).toBe(1); // first link by id
    expect(u2Links[0].domain).toBe("firstorg.io");
  });

  it("a stronger later signal upgrades the primary on re-run; nothing is deleted", async () => {
    run(
      "INSERT INTO github_user_emails (user_id, email, domain, source) VALUES (?, 'me@secondorg.io', 'secondorg.io', 'commit')",
      u2
    );
    await resolveCompanies();

    const u2Links = primariesOf(u2);
    expect(u2Links).toHaveLength(2); // links intact, none deleted
    const primary = u2Links.find((l) => l.p === 1)!;
    expect(primary.domain).toBe("secondorg.io");
    expect(primary.source).toBe("email_domain"); // upsert lifted confidence + source
  });
});
