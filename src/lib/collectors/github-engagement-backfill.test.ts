import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { GithubClient, Page, PageOptions } from "../api-clients/github-client";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-backfill-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { collectGithubEngagement } = await import("./github-engagement");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite.prepare("INSERT INTO tracked_repos (owner, name) VALUES ('us', 'own-repo')").run();
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, competitor) VALUES ('them', 'rival-repo', 'Acme')"
  )
  .run();
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name = 'rival-repo'").get() as { id: number }
).id;

// Per-repo call recorder: the test's whole point is asserting WHAT the
// collector asks the client for on first vs subsequent collections.
const calls: Record<
  string,
  {
    stars: PageOptions[];
    forks: PageOptions[];
    issuesSince: string[];
    issuesOpts: PageOptions[];
    prs: PageOptions[];
  }
> = {
  "own-repo": { stars: [], forks: [], issuesSince: [], issuesOpts: [], prs: [] },
  "rival-repo": { stars: [], forks: [], issuesSince: [], issuesOpts: [], prs: [] },
};

async function* onePage<T>(items: T[]): AsyncGenerator<Page<T>> {
  if (items.length > 0) yield { page: 1, items, isLast: true };
}
async function* noPages<T>(): AsyncGenerator<Page<T>> {}

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
  stargazerPages: (owner, repo, opts) => {
    calls[repo].stars.push(opts!);
    return repo === "rival-repo"
      ? onePage([
          {
            user: { login: "both-sides", id: 1, avatar_url: "" },
            starred_at: "2026-06-01T10:00:00Z",
          },
          {
            user: { login: "rival-fan", id: 2, avatar_url: "" },
            starred_at: "2026-06-01T11:00:00Z",
          },
        ])
      : onePage([
          {
            user: { login: "both-sides", id: 1, avatar_url: "" },
            starred_at: "2026-06-02T10:00:00Z",
          },
        ]);
  },
  forkPages: (owner, repo, opts) => {
    calls[repo].forks.push(opts!);
    return noPages();
  },
  issuePages: (owner, repo, since, opts) => {
    calls[repo].issuesSince.push(since);
    calls[repo].issuesOpts.push(opts!);
    return repo === "rival-repo"
      ? onePage([
          {
            number: 7,
            title: "old pain",
            created_at: "2024-01-15T00:00:00Z",
            user: { login: "rival-filer", id: 3, avatar_url: "" },
          },
        ])
      : noPages();
  },
  prPages: (owner, repo, opts) => {
    calls[repo].prs.push(opts!);
    return noPages();
  },
  commitPages: () => noPages(),
};

describe("competitor backfill on first collection", () => {
  it("first run: full history for the competitor repo, normal windows for our own", async () => {
    await collectGithubEngagement(fakeClient);

    // Competitor repo: backfill mode. Issues need the deep page cap too: the
    // GitHub /issues endpoint mixes PRs in, so on PR-heavy repos a shallow
    // cap gets consumed by PR rows before reaching a single true issue.
    expect(calls["rival-repo"].stars[0].maxPages).toBe(60);
    expect(calls["rival-repo"].forks[0].maxPages).toBe(60);
    expect(calls["rival-repo"].issuesSince[0]).toBe("2008-01-01T00:00:00Z");
    expect(calls["rival-repo"].issuesOpts[0].maxPages).toBe(60);
    expect(calls["rival-repo"].prs[0].maxPages).toBe(20);

    // Own repo: existing behavior (5-page cap, ~90-day issue window)
    expect(calls["own-repo"].stars[0].maxPages).toBe(5);
    expect(calls["own-repo"].issuesSince[0]).not.toBe("2008-01-01T00:00:00Z");
    expect(calls["own-repo"].issuesOpts[0].maxPages).toBe(5);
    expect(calls["own-repo"].prs[0].maxPages).toBe(3);

    // Backfill flagged done
    const backfilled = sqlite
      .prepare(
        "SELECT cursor_value FROM collection_cursors WHERE cursor_type = 'backfilled' AND repo_id = ?"
      )
      .get(rivalId) as { cursor_value: string } | undefined;
    expect(backfilled?.cursor_value).toBe("1");

    // Old issue author captured — the whole point of the backfill
    const issueEvent = sqlite
      .prepare(
        "SELECT event_date FROM github_engagement_events WHERE repo_id = ? AND event_type = 'issue'"
      )
      .get(rivalId) as { event_date: string };
    expect(issueEvent.event_date).toBe("2024-01-15");
  });

  it("competitor-sourced users enqueue below own-repo users; both-sides users get the own band", () => {
    const priority = (login: string) =>
      (
        sqlite.prepare("SELECT priority FROM enrichment_queue WHERE user_login = ?").get(login) as {
          priority: number;
        }
      ).priority;

    expect(priority("rival-fan")).toBe(1 - 100); // competitor star
    expect(priority("rival-filer")).toBe(3 - 100); // competitor issue
    expect(priority("both-sides")).toBe(1); // starred both — MAX() lifts to own band
  });

  it("second run: competitor repo back on incremental windows", async () => {
    await collectGithubEngagement(fakeClient);

    expect(calls["rival-repo"].stars[1].maxPages).toBe(5);
    expect(calls["rival-repo"].forks[1].maxPages).toBe(5);
    expect(calls["rival-repo"].issuesSince[1]).not.toBe("2008-01-01T00:00:00Z");
    expect(calls["rival-repo"].issuesOpts[1].maxPages).toBe(5);
    expect(calls["rival-repo"].prs[1].maxPages).toBe(3);
  });
});
