import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { GtmConfig } from "../config/gtm-config";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-employees-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { tagCompetitorEmployees } = await import("./competitor-employees");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);

run("INSERT INTO tracked_repos (owner, name) VALUES ('us', 'own-repo')");
run("INSERT INTO tracked_repos (owner, name, competitor) VALUES ('pinata', 'pinata-sdk', 'Pinata')");
const ownRepoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='own-repo'").get() as { id: number }
).id;
const rivalRepoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='pinata-sdk'").get() as { id: number }
).id;

const user = (login: string) => {
  run("INSERT INTO github_users (login) VALUES (?)", login);
  return (sqlite.prepare("SELECT id FROM github_users WHERE login=?").get(login) as { id: number })
    .id;
};
const committer = user("committer"); // signal 1: commits on the competitor repo (+ stars ours)
const orgMember = user("org-member"); // signal 2: member of the owning org
const domainHire = user("domain-hire"); // signal 3: resolved company domain matches config
const cleanProspect = user("clean-prospect"); // issue-filer — must stay untagged

const event = (repoId: number, userId: number, type: string, eventId: string) =>
  run(
    "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id) VALUES (?, ?, ?, ?)",
    repoId,
    userId,
    type,
    eventId
  );
event(rivalRepoId, committer, "commit", "sha1");
event(ownRepoId, committer, "star", "star");
event(rivalRepoId, cleanProspect, "issue", "issue-1");

run(
  "INSERT INTO github_user_orgs (user_id, org_login, org_name) VALUES (?, 'Pinata', 'Pinata Inc')",
  orgMember
);

run("INSERT INTO companies (name, domain) VALUES ('Pinata Inc', 'pinata.cloud')");
const pinataCompanyId = (
  sqlite.prepare("SELECT id FROM companies WHERE domain='pinata.cloud'").get() as { id: number }
).id;
run(
  "INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')",
  domainHire,
  pinataCompanyId
);

const CONFIG: GtmConfig = {
  github: { repos: [{ owner: "pinata", name: "pinata-sdk", competitor: "Pinata" }] },
  packages: { npm: [], pypi: [] },
  competitors: { Pinata: { domains: ["pinata.cloud"] } },
};

const tagOf = (login: string) =>
  sqlite
    .prepare(
      "SELECT competitor_employee AS who, competitor_employee_source AS src FROM github_users WHERE login = ?"
    )
    .get(login) as { who: string | null; src: string | null };

describe("tagCompetitorEmployees", () => {
  it("tags via all three signals independently, recording the source", async () => {
    await tagCompetitorEmployees(CONFIG);

    expect(tagOf("committer")).toEqual({ who: "Pinata", src: "commit_activity" });
    expect(tagOf("org-member")).toEqual({ who: "Pinata", src: "org_membership" });
    expect(tagOf("domain-hire")).toEqual({ who: "Pinata", src: "domain_match" });
    expect(tagOf("clean-prospect")).toEqual({ who: null, src: null });
  });

  it("is additive — re-runs never overwrite an existing tag", async () => {
    // Give the committer an org membership too: the earlier commit_activity
    // tag must survive.
    run(
      "INSERT INTO github_user_orgs (user_id, org_login, org_name) VALUES (?, 'pinata', 'Pinata Inc')",
      committer
    );
    await tagCompetitorEmployees(CONFIG);
    expect(tagOf("committer")).toEqual({ who: "Pinata", src: "commit_activity" });
  });

  it("degrades gracefully without a competitors block: signals 1–2 only", async () => {
    const freshHire = user("fresh-hire");
    run(
      "INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')",
      freshHire,
      pinataCompanyId
    );
    await tagCompetitorEmployees({
      github: { repos: [] },
      packages: { npm: [], pypi: [] },
    });
    expect(tagOf("fresh-hire")).toEqual({ who: null, src: null });
  });
});
