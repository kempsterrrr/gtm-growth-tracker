import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { GithubClient, Page } from "../api-clients/github-client";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-engagement-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { collectGithubEngagement } = await import("./github-engagement");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, display_name) VALUES ('ar-io', 'ar-io-node', 'AR.IO Node')"
  )
  .run();
const repoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name = 'ar-io-node'").get() as { id: number }
).id;

async function* onePage<T>(items: T[]): AsyncGenerator<Page<T>> {
  if (items.length > 0) yield { page: 1, items, isLast: true };
}

async function* noPages<T>(): AsyncGenerator<Page<T>> {}

/** Fake client: two stargazers and one commit; every other resource empty. */
const fakeClient: GithubClient = {
  getRepo: async () => {
    throw new Error("not used");
  },
  getTrafficClones: async () => {
    throw new Error("not used");
  },
  getTrafficViews: async () => {
    throw new Error("not used");
  },
  getReleases: async () => {
    throw new Error("not used");
  },
  getContributorStats: async () => {
    throw new Error("not used");
  },
  getUserProfile: async () => {
    throw new Error("not used");
  },
  getUserOrgs: async () => {
    throw new Error("not used");
  },
  stargazerPages: () =>
    onePage([
      { user: { login: "alice", id: 1, avatar_url: "" }, starred_at: "2026-06-01T10:00:00Z" },
      { user: { login: "bob", id: 2, avatar_url: "" }, starred_at: "2026-06-02T10:00:00Z" },
    ]),
  forkPages: () => noPages(),
  issuePages: () => noPages(),
  prPages: () => noPages(),
  commitPages: () =>
    onePage([
      {
        sha: "abc123",
        author: { login: "alice", id: 1, avatar_url: "" },
        commit: { author: { name: "Alice", email: "alice@acme.dev", date: "2026-06-02T12:00:00Z" } },
      },
    ]),
};

describe("collectGithubEngagement against a fake client", () => {
  it("upserts engagement events, queues enrichment, and advances cursors", async () => {
    await collectGithubEngagement(fakeClient);

    const events = sqlite
      .prepare(
        "SELECT event_type, github_event_id FROM github_engagement_events WHERE repo_id = ? ORDER BY id"
      )
      .all(repoId) as Array<{ event_type: string; github_event_id: string }>;
    expect(events.map((e) => e.event_type).sort()).toEqual(["commit", "star", "star"]);
    expect(events.find((e) => e.event_type === "commit")?.github_event_id).toBe("abc123");

    const users = sqlite.prepare("SELECT login FROM github_users ORDER BY login").all() as Array<{
      login: string;
    }>;
    expect(users.map((u) => u.login)).toEqual(["alice", "bob"]);

    const queued = sqlite
      .prepare("SELECT user_login FROM enrichment_queue ORDER BY user_login")
      .all() as Array<{ user_login: string }>;
    expect(queued.map((q) => q.user_login)).toEqual(["alice", "bob"]);

    const cursor = (name: string) =>
      (
        sqlite
          .prepare(
            "SELECT cursor_value FROM collection_cursors WHERE cursor_type = ? AND repo_id = ?"
          )
          .get(name, repoId) as { cursor_value: string } | undefined
      )?.cursor_value;
    expect(cursor("stargazers")).toBe("1"); // last page reached → cursor reset
    expect(cursor("issues_since")).toBeTruthy();
    expect(cursor("commits_since")).toBeTruthy();
  });

  it("is idempotent — a second run creates no duplicate events", async () => {
    await collectGithubEngagement(fakeClient);
    const count = (
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM github_engagement_events WHERE repo_id = ?")
        .get(repoId) as { n: number }
    ).n;
    expect(count).toBe(3);
  });
});
