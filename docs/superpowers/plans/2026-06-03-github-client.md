# Single Deep GitHub Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the two GitHub fetch wrappers into one deep client owning auth, a single rate-limit wait/retry policy, pagination, and typed errors — with an injected-fetch test seam — so collectors read as domain logic and are testable offline (GitHub issue #6).

**Architecture:** `src/lib/api-clients/github-client.ts` is rewritten as the single module that touches `api.github.com`: `createGithubClient({token?, fetchImpl?, sleep?})` returns a `GithubClient` of typed resource methods plus per-resource async page iterators. Collectors take an optional `client: GithubClient = createGithubClient()` parameter (the fake-client seam). `github-users-client.ts` is deleted; the skip-below-100 and batch-shrinking rate-limit code paths in collectors are deleted (the client waiting makes them redundant); `requireGithubToken` leaves `definition.ts` because the client constructor now throws the same typed error (token read in exactly one place).

**Tech Stack:** TypeScript, Vitest (fake `fetch` via `Response`, fake `sleep` spy), better-sqlite3 temp-DB seam from the orchestrator PRD.

**Key constraints from the PRD (issue #6):**
- One rate-limit policy: below one threshold constant, sleep until reset, continue. Delete warn-only, skip-below-100, and dynamic batch-shrinking paths.
- Pagination inside the client; collectors never build page URLs.
- Non-2xx → typed error carrying status + endpoint; propagates to the orchestrator's failure isolation.
- No change to what data is collected or any table shape. npm/PyPI/deps.dev/Slack clients untouched.
- Cursor semantics in the engagement collector must be preserved (stargazers resume-page cursor, `issues_since`/`commits_since` timestamps) — the page iterator exposes `page` and `isLast` so the collector keeps cursor logic without knowing HTTP.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/api-clients/github-client.ts` | Rewrite | THE GitHub module: auth, rate-limit policy, pagination, typed errors, all resource types |
| `src/lib/api-clients/github-client.test.ts` | Create | Client tests via injected fake fetch + sleep spy |
| `src/lib/api-clients/github-users-client.ts` | Delete (Task 4) | Merged into github-client |
| `src/lib/collectors/github.ts` | Modify | Consume injected client |
| `src/lib/collectors/events-auto.ts` | Modify | Consume injected client |
| `src/lib/collectors/github-engagement.ts` | Rewrite loops | Page iterators; delete skip-below-100 + getRateLimit |
| `src/lib/collectors/github-engagement.test.ts` | Create | Fake client + temp DB: events upserted, cursors advance |
| `src/lib/collectors/github-user-enrichment.ts` | Modify | Delete batch-shrinking; consume injected client |
| `src/lib/pipeline/definition.ts` | Modify | Remove `requireGithubToken` (client constructor owns it) |
| `CLAUDE.md` | Modify | Document the single client |

---

### Task 1: The client (TDD)

**Files:**
- Create: `src/lib/api-clients/github-client.test.ts`
- Rewrite: `src/lib/api-clients/github-client.ts`

Note: rewriting `github-client.ts` breaks the type-check of `src/lib/collectors/github.ts` / `events-auto.ts` until Task 2 — `npm test` stays green throughout; `npm run build` is verified again at the end of Task 2.

- [ ] **Step 1: Write the failing tests — `src/lib/api-clients/github-client.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createGithubClient,
  GithubApiError,
  GithubAuthError,
  type Page,
  type StargazerEntry,
} from "./github-client";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** fetch stub fed by a queue of responses; records nothing about URLs beyond what the page param needs */
function fetchQueue(responses: Response[]) {
  let i = 0;
  return vi.fn(async () => {
    if (i >= responses.length) throw new Error("fetchQueue exhausted");
    return responses[i++];
  }) as unknown as typeof fetch;
}

const noSleep = vi.fn(async () => {});

beforeEach(() => {
  noSleep.mockClear();
});

describe("createGithubClient auth", () => {
  let savedToken: string | undefined;
  beforeEach(() => {
    savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });
  afterEach(() => {
    if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
  });

  it("throws GithubAuthError when no token is available", () => {
    expect(() => createGithubClient()).toThrow(GithubAuthError);
  });

  it("accepts an explicit token", () => {
    expect(() => createGithubClient({ token: "t", fetchImpl: fetchQueue([]) })).not.toThrow();
  });
});

describe("typed errors", () => {
  it("throws GithubApiError carrying status and endpoint on 500", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([jsonResponse({ message: "boom" }, { status: 500 })]),
      sleep: noSleep,
    });
    const err = await client.getRepo("ar-io", "ar-io-node").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(500);
    expect(err.endpoint).toContain("/repos/ar-io/ar-io-node");
  });
});

describe("rate-limit policy", () => {
  it("sleeps until the reset timestamp when remaining drops below the threshold", async () => {
    const reset = Math.floor(Date.now() / 1000) + 30;
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse(
          { stargazers_count: 1, forks_count: 1, subscribers_count: 1, open_issues_count: 1 },
          { headers: { "x-ratelimit-remaining": "5", "x-ratelimit-reset": String(reset) } }
        ),
      ]),
      sleep: noSleep,
    });
    await client.getRepo("a", "b");
    expect(noSleep).toHaveBeenCalledTimes(1);
    const waited = noSleep.mock.calls[0][0] as number;
    expect(waited).toBeGreaterThan(20_000);
    expect(waited).toBeLessThanOrEqual(31_000);
  });

  it("does not sleep when remaining is above the threshold", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse({}, { headers: { "x-ratelimit-remaining": "500", "x-ratelimit-reset": "0" } }),
      ]),
      sleep: noSleep,
    });
    await client.getRepo("a", "b");
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("waits for the window and retries once when the limit is exhausted (403, remaining 0)", async () => {
    const reset = Math.floor(Date.now() / 1000) + 1;
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse(
          { message: "rate limited" },
          { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }
        ),
        jsonResponse({ ok: true }),
      ]),
      sleep: noSleep,
    });
    const result = await client.getRepo("a", "b");
    expect(result).toEqual({ ok: true });
    expect(noSleep).toHaveBeenCalledTimes(1);
  });
});

describe("pagination", () => {
  const star = (n: number): StargazerEntry => ({
    user: { login: `user${n}`, id: n, avatar_url: "" },
    starred_at: "2026-06-01T00:00:00Z",
  });

  async function collect<T>(iter: AsyncIterable<Page<T>>): Promise<Page<T>[]> {
    const pages: Page<T>[] = [];
    for await (const p of iter) pages.push(p);
    return pages;
  }

  it("assembles multiple pages and flags the last one", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse(Array.from({ length: 100 }, (_, i) => star(i))),
        jsonResponse([star(100), star(101)]),
      ]),
      sleep: noSleep,
    });
    const pages = await collect(client.stargazerPages("a", "b"));
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[0].isLast).toBe(false);
    expect(pages[1].page).toBe(2);
    expect(pages[1].isLast).toBe(true);
    expect(pages.flatMap((p) => p.items)).toHaveLength(102);
  });

  it("stops at maxPages and respects startPage", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([jsonResponse(Array.from({ length: 100 }, (_, i) => star(i)))]),
      sleep: noSleep,
    });
    const pages = await collect(client.stargazerPages("a", "b", { startPage: 3, maxPages: 1 }));
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(3);
    expect(pages[0].isLast).toBe(false);
  });

  it("yields nothing for an empty first page", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([jsonResponse([])]),
      sleep: noSleep,
    });
    const pages = await collect(client.stargazerPages("a", "b"));
    expect(pages).toHaveLength(0);
  });

  it("filters pull requests out of the issues resource but pages on the raw count", async () => {
    const issue = (n: number, pr: boolean) => ({
      number: n,
      title: `t${n}`,
      user: { login: `u${n}`, id: n, avatar_url: "" },
      created_at: "2026-06-01T00:00:00Z",
      ...(pr ? { pull_request: {} } : {}),
    });
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([jsonResponse([issue(1, false), issue(2, true), issue(3, false)])]),
      sleep: noSleep,
    });
    const pages = await collect(client.issuePages("a", "b", "2026-01-01T00:00:00Z"));
    expect(pages).toHaveLength(1);
    expect(pages[0].items.map((i) => i.number)).toEqual([1, 3]);
    expect(pages[0].isLast).toBe(true); // 3 raw items < 100
  });
});

describe("contributor stats 202 handling", () => {
  it("retries while GitHub is computing and returns [] if it never finishes", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse(null, { status: 202 }),
        jsonResponse(null, { status: 202 }),
        jsonResponse(null, { status: 202 }),
      ]),
      sleep: noSleep,
    });
    const stats = await client.getContributorStats("a", "b");
    expect(stats).toEqual([]);
  });

  it("returns stats once computation completes", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse(null, { status: 202 }),
        jsonResponse([{ author: { login: "x", avatar_url: "" }, total: 1, weeks: [] }]),
      ]),
      sleep: noSleep,
    });
    const stats = await client.getContributorStats("a", "b");
    expect(stats).toHaveLength(1);
  });
});

describe("user orgs", () => {
  it("fetches org details and falls back to summary data when a detail fetch fails", async () => {
    const client = createGithubClient({
      token: "t",
      fetchImpl: fetchQueue([
        jsonResponse([
          { login: "org1", description: "d1", url: "" },
          { login: "org2", description: "d2", url: "" },
        ]),
        jsonResponse({ login: "org1", name: "Org One", description: "d1", blog: "https://one.dev" }),
        jsonResponse({ message: "nope" }, { status: 404 }),
      ]),
      sleep: noSleep,
    });
    const orgs = await client.getUserOrgs("someone");
    expect(orgs).toEqual([
      { login: "org1", name: "Org One", description: "d1", blog: "https://one.dev" },
      { login: "org2", name: null, description: "d2", blog: "" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/api-clients/github-client.test.ts`
Expected: FAIL — `createGithubClient` is not exported by the current module.

- [ ] **Step 3: Rewrite `src/lib/api-clients/github-client.ts`**

```ts
const GITHUB_API_BASE = "https://api.github.com";

/** Single rate-limit policy: when the remaining budget drops below this, sleep until reset. */
const RATE_LIMIT_THRESHOLD = 10;
const PER_PAGE = 100;

export class GithubAuthError extends Error {
  constructor() {
    super("GITHUB_TOKEN is not set — GitHub collection cannot run");
    this.name = "GithubAuthError";
  }
}

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string
  ) {
    super(`GitHub API error: ${status} for ${endpoint}`);
    this.name = "GithubApiError";
  }
}

// ── Resource types ──────────────────────────────────────────────────────

export interface GithubRepoData {
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
}

export interface GithubTrafficClones {
  count: number;
  uniques: number;
  clones: Array<{ timestamp: string; count: number; uniques: number }>;
}

export interface GithubTrafficViews {
  count: number;
  uniques: number;
  views: Array<{ timestamp: string; count: number; uniques: number }>;
}

export interface GithubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
}

export interface GithubContributorStat {
  author: { login: string; avatar_url: string };
  total: number;
  weeks: Array<{ w: number; a: number; d: number; c: number }>;
}

export interface GithubUserProfile {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  company: string | null;
  bio: string | null;
  blog: string | null;
  avatar_url: string;
  location: string | null;
  twitter_username: string | null;
}

interface GithubOrgSummary {
  login: string;
  description: string | null;
  url: string;
}

export interface GithubOrgDetail {
  login: string;
  name: string | null;
  description: string | null;
  blog: string;
}

export interface StargazerEntry {
  user: { login: string; id: number; avatar_url: string };
  starred_at: string;
}

export interface ForkEntry {
  owner: { login: string; id: number; type: string; avatar_url: string };
  created_at: string;
}

export interface IssueEntry {
  number: number;
  title: string;
  user: { login: string; id: number; avatar_url: string };
  created_at: string;
  pull_request?: unknown;
}

export interface PREntry {
  number: number;
  title: string;
  user: { login: string; id: number; avatar_url: string };
  created_at: string;
}

export interface CommitEntry {
  sha: string;
  author: { login: string; id: number; avatar_url: string } | null;
  commit: { author: { name: string; email: string; date: string } };
}

// ── Client interface ────────────────────────────────────────────────────

export interface PageOptions {
  startPage?: number;
  maxPages?: number;
}

export interface Page<T> {
  page: number;
  items: T[];
  isLast: boolean;
}

export interface GithubClient {
  getRepo(owner: string, name: string): Promise<GithubRepoData>;
  getTrafficClones(owner: string, name: string): Promise<GithubTrafficClones>;
  getTrafficViews(owner: string, name: string): Promise<GithubTrafficViews>;
  getReleases(owner: string, name: string): Promise<GithubRelease[]>;
  getContributorStats(owner: string, name: string): Promise<GithubContributorStat[]>;
  getUserProfile(login: string): Promise<GithubUserProfile>;
  getUserOrgs(login: string): Promise<GithubOrgDetail[]>;
  stargazerPages(owner: string, repo: string, opts?: PageOptions): AsyncIterable<Page<StargazerEntry>>;
  forkPages(owner: string, repo: string, opts?: PageOptions): AsyncIterable<Page<ForkEntry>>;
  issuePages(owner: string, repo: string, since: string, opts?: PageOptions): AsyncIterable<Page<IssueEntry>>;
  prPages(owner: string, repo: string, opts?: PageOptions): AsyncIterable<Page<PREntry>>;
  commitPages(owner: string, repo: string, since: string, opts?: PageOptions): AsyncIterable<Page<CommitEntry>>;
}

export interface GithubClientOptions {
  /** Defaults to process.env.GITHUB_TOKEN — the only place the token is read. */
  token?: string;
  /** Test seam: injected fetch implementation. */
  fetchImpl?: typeof fetch;
  /** Test seam: injected sleep for rate-limit waits. */
  sleep?: (ms: number) => Promise<void>;
}

export function createGithubClient(options: GithubClientOptions = {}): GithubClient {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) throw new GithubAuthError();
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function rawRequest(
    path: string,
    extraHeaders?: Record<string, string>,
    isRetry = false
  ): Promise<Response> {
    const resp = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "gtm-growth-tracker",
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
    });

    if (!resp.ok) {
      // Limit exhausted: wait for the window to reset, then retry once.
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const reset = parseInt(resp.headers.get("x-ratelimit-reset") ?? "", 10);
      if ((resp.status === 403 || resp.status === 429) && remaining === "0" && !Number.isNaN(reset) && !isRetry) {
        const waitMs = Math.max(reset * 1000 - Date.now(), 0);
        console.warn(
          `[github-client] Rate limit exhausted, waiting ${Math.ceil(waitMs / 1000)}s until ${new Date(reset * 1000).toISOString()}`
        );
        await sleep(waitMs);
        return rawRequest(path, extraHeaders, true);
      }
      throw new GithubApiError(resp.status, path);
    }

    // Proactive wait: protect the NEXT request when the budget runs low.
    const remaining = parseInt(resp.headers.get("x-ratelimit-remaining") ?? "", 10);
    if (!Number.isNaN(remaining) && remaining < RATE_LIMIT_THRESHOLD) {
      const reset = parseInt(resp.headers.get("x-ratelimit-reset") ?? "", 10);
      const waitMs = Number.isNaN(reset) ? 0 : reset * 1000 - Date.now();
      if (waitMs > 0) {
        console.warn(
          `[github-client] Rate limit low (${remaining} remaining), waiting ${Math.ceil(waitMs / 1000)}s until ${new Date(reset * 1000).toISOString()}`
        );
        await sleep(waitMs);
      }
    }

    return resp;
  }

  async function request<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    const resp = await rawRequest(path, extraHeaders);
    return resp.json() as Promise<T>;
  }

  async function* pages<T>(
    pathForPage: (page: number) => string,
    opts: PageOptions = {},
    extraHeaders?: Record<string, string>,
    filterItems?: (items: T[]) => T[]
  ): AsyncGenerator<Page<T>> {
    const start = opts.startPage ?? 1;
    const max = opts.maxPages ?? Number.POSITIVE_INFINITY;
    for (let page = start; page < start + max; page++) {
      const raw = await request<T[]>(pathForPage(page), extraHeaders);
      if (raw.length === 0) return;
      const items = filterItems ? filterItems(raw) : raw;
      const isLast = raw.length < PER_PAGE;
      yield { page, items, isLast };
      if (isLast) return;
    }
  }

  return {
    getRepo: (owner, name) => request(`/repos/${owner}/${name}`),
    getTrafficClones: (owner, name) => request(`/repos/${owner}/${name}/traffic/clones`),
    getTrafficViews: (owner, name) => request(`/repos/${owner}/${name}/traffic/views`),
    getReleases: (owner, name) => request(`/repos/${owner}/${name}/releases?per_page=${PER_PAGE}`),

    getContributorStats: async (owner, name) => {
      const path = `/repos/${owner}/${name}/stats/contributors`;
      // GitHub returns 202 while computing stats — retry a few times, then give up gracefully.
      for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await rawRequest(path);
        if (resp.status === 202) {
          await sleep(2000);
          continue;
        }
        return resp.json() as Promise<GithubContributorStat[]>;
      }
      return [];
    },

    getUserProfile: (login) => request(`/users/${encodeURIComponent(login)}`),

    getUserOrgs: async (login) => {
      const orgs = await request<GithubOrgSummary[]>(`/users/${encodeURIComponent(login)}/orgs`);
      const details: GithubOrgDetail[] = [];
      for (const org of orgs.slice(0, 5)) {
        try {
          details.push(await request<GithubOrgDetail>(`/orgs/${encodeURIComponent(org.login)}`));
        } catch {
          // Detail fetch is best-effort; fall back to the summary fields.
          details.push({ login: org.login, name: null, description: org.description, blog: "" });
        }
      }
      return details;
    },

    stargazerPages: (owner, repo, opts) =>
      pages<StargazerEntry>(
        (p) => `/repos/${owner}/${repo}/stargazers?per_page=${PER_PAGE}&page=${p}`,
        opts,
        { Accept: "application/vnd.github.star+json" }
      ),

    forkPages: (owner, repo, opts) =>
      pages<ForkEntry>(
        (p) => `/repos/${owner}/${repo}/forks?sort=newest&per_page=${PER_PAGE}&page=${p}`,
        opts
      ),

    issuePages: (owner, repo, since, opts) =>
      pages<IssueEntry>(
        (p) =>
          `/repos/${owner}/${repo}/issues?state=all&since=${encodeURIComponent(since)}&sort=updated&per_page=${PER_PAGE}&page=${p}`,
        opts,
        undefined,
        (items) => items.filter((i) => !i.pull_request)
      ),

    prPages: (owner, repo, opts) =>
      pages<PREntry>(
        (p) => `/repos/${owner}/${repo}/pulls?state=all&sort=updated&per_page=${PER_PAGE}&page=${p}`,
        opts
      ),

    commitPages: (owner, repo, since, opts) =>
      pages<CommitEntry>(
        (p) =>
          `/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&per_page=${PER_PAGE}&page=${p}`,
        opts
      ),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/api-clients/github-client.test.ts`
Expected: PASS (all client tests). `npm test` also passes (pipeline tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-clients/github-client.ts src/lib/api-clients/github-client.test.ts
git commit -m "feat: one deep GitHub client with rate-limit wait, pagination, typed errors"
```

---

### Task 2: Metrics and events collectors consume the client

**Files:**
- Modify: `src/lib/collectors/github.ts`
- Modify: `src/lib/collectors/events-auto.ts`

- [ ] **Step 1: Update `src/lib/collectors/github.ts`**

Replace the import line:
```ts
import { getRepo, getTrafficClones, getTrafficViews, getContributorStats } from "../api-clients/github-client";
```
with:
```ts
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
```

Change the signature:
```ts
export async function collectGithubMetrics(client: GithubClient = createGithubClient()) {
```

And the four call sites inside the function body:
- `await getRepo(repo.owner, repo.name)` → `await client.getRepo(repo.owner, repo.name)`
- `await getContributorStats(repo.owner, repo.name)` → `await client.getContributorStats(repo.owner, repo.name)`
- `await getTrafficClones(repo.owner, repo.name)` → `await client.getTrafficClones(repo.owner, repo.name)`
- `await getTrafficViews(repo.owner, repo.name)` → `await client.getTrafficViews(repo.owner, repo.name)`

Nothing else in the file changes.

- [ ] **Step 2: Update `src/lib/collectors/events-auto.ts`**

Replace:
```ts
import { getReleases } from "../api-clients/github-client";
```
with:
```ts
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
```

Change the signature and the one call site:
```ts
export async function collectAutoEvents(client: GithubClient = createGithubClient()) {
```
- `await getReleases(repo.owner, repo.name)` → `await client.getReleases(repo.owner, repo.name)`

- [ ] **Step 3: Verify tests and build**

Run: `npm test && npm run build`
Expected: tests PASS; build succeeds (engagement/enrichment still compile against the untouched `github-users-client.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/collectors/github.ts src/lib/collectors/events-auto.ts
git commit -m "refactor: metrics and events collectors consume the injected GitHub client"
```

---

### Task 3: Engagement collector — page iterators + fake-client test (TDD)

**Files:**
- Create: `src/lib/collectors/github-engagement.test.ts`
- Modify: `src/lib/collectors/github-engagement.ts`

- [ ] **Step 1: Write the failing test — `src/lib/collectors/github-engagement.test.ts`**

```ts
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
  .prepare("INSERT INTO tracked_repos (owner, name, display_name) VALUES ('ar-io', 'ar-io-node', 'AR.IO Node')")
  .run();
const repoId = (sqlite.prepare("SELECT id FROM tracked_repos WHERE name = 'ar-io-node'").get() as { id: number }).id;

async function* onePage<T>(items: T[]): AsyncGenerator<Page<T>> {
  if (items.length > 0) yield { page: 1, items, isLast: true };
}

async function* noPages<T>(): AsyncGenerator<Page<T>> {}

/** Fake client: two stargazers and one commit; every other resource empty. */
const fakeClient: GithubClient = {
  getRepo: async () => { throw new Error("not used"); },
  getTrafficClones: async () => { throw new Error("not used"); },
  getTrafficViews: async () => { throw new Error("not used"); },
  getReleases: async () => { throw new Error("not used"); },
  getContributorStats: async () => { throw new Error("not used"); },
  getUserProfile: async () => { throw new Error("not used"); },
  getUserOrgs: async () => { throw new Error("not used"); },
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
      .prepare("SELECT event_type, github_event_id FROM github_engagement_events WHERE repo_id = ? ORDER BY id")
      .all(repoId) as Array<{ event_type: string; github_event_id: string }>;
    expect(events.map((e) => e.event_type).sort()).toEqual(["commit", "star", "star"]);
    expect(events.find((e) => e.event_type === "commit")?.github_event_id).toBe("abc123");

    const users = sqlite.prepare("SELECT login FROM github_users ORDER BY login").all() as Array<{ login: string }>;
    expect(users.map((u) => u.login)).toEqual(["alice", "bob"]);

    const queued = sqlite.prepare("SELECT user_login FROM enrichment_queue ORDER BY user_login").all() as Array<{ user_login: string }>;
    expect(queued.map((q) => q.user_login)).toEqual(["alice", "bob"]);

    const cursor = (name: string) =>
      (sqlite.prepare("SELECT cursor_value FROM collection_cursors WHERE cursor_type = ? AND repo_id = ?").get(name, repoId) as { cursor_value: string } | undefined)?.cursor_value;
    expect(cursor("stargazers")).toBe("1"); // last page reached → cursor reset
    expect(cursor("issues_since")).toBeTruthy();
    expect(cursor("commits_since")).toBeTruthy();
  });

  it("is idempotent — a second run creates no duplicate events", async () => {
    await collectGithubEngagement(fakeClient);
    const count = (sqlite.prepare("SELECT COUNT(*) AS n FROM github_engagement_events WHERE repo_id = ?").get(repoId) as { n: number }).n;
    expect(count).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/collectors/github-engagement.test.ts`
Expected: FAIL — `collectGithubEngagement` does not accept a client argument (or type errors against the old `github-users-client` imports).

- [ ] **Step 3: Rewrite the collection loops in `src/lib/collectors/github-engagement.ts`**

Replace the import of the old users client:
```ts
import {
  getStargazers, getForkers, getRepoIssues, getRepoPRs, getRepoCommits, getRateLimit,
} from "../api-clients/github-users-client";
```
with:
```ts
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
```

The helpers (`ensureUser`, `recordEvent`, `queueEnrichment`, `getCursor`, `setCursor`) and `MAX_PAGES_PER_ENDPOINT` are unchanged. Replace the whole `collectGithubEngagement` function with:

```ts
export async function collectGithubEngagement(client: GithubClient = createGithubClient()) {
  const db = getDb();
  const repos = db.select().from(trackedRepos).all();

  if (repos.length === 0) {
    console.log("[engagement] No repos to collect");
    return;
  }

  for (const repo of repos) {
    const owner = repo.owner;
    const name = repo.name;
    console.log(`[engagement] Collecting ${owner}/${name}...`);

    // Stars (resumable page cursor)
    const starPage = parseInt(getCursor(db, "stargazers", repo.id) || "1");
    let starCount = 0;
    try {
      for await (const page of client.stargazerPages(owner, name, {
        startPage: starPage,
        maxPages: MAX_PAGES_PER_ENDPOINT,
      })) {
        for (const s of page.items) {
          const userId = ensureUser(db, s.user.login, s.user.id, s.user.avatar_url);
          recordEvent(db, repo.id, userId, "star", s.starred_at?.split("T")[0] || null, "star");
          queueEnrichment(db, s.user.login, "star");
          starCount++;
        }
        setCursor(db, "stargazers", repo.id, page.isLast ? "1" : String(page.page + 1));
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: stargazers collection stopped:`, err);
    }
    console.log(`[engagement] ${owner}/${name}: ${starCount} stargazers processed`);

    // Forks
    let forkCount = 0;
    try {
      for await (const page of client.forkPages(owner, name, { maxPages: MAX_PAGES_PER_ENDPOINT })) {
        for (const f of page.items) {
          const userId = ensureUser(db, f.owner.login, f.owner.id, f.owner.avatar_url);
          recordEvent(db, repo.id, userId, "fork", f.created_at?.split("T")[0] || null, `fork-${f.owner.login}`);
          queueEnrichment(db, f.owner.login, "fork");
          forkCount++;
        }
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: forks collection stopped:`, err);
    }
    console.log(`[engagement] ${owner}/${name}: ${forkCount} forks processed`);

    // Issues (since last collection)
    const issueSince = getCursor(db, "issues_since", repo.id) || new Date(Date.now() - 90 * 86400000).toISOString();
    let issueCount = 0;
    try {
      for await (const page of client.issuePages(owner, name, issueSince, { maxPages: MAX_PAGES_PER_ENDPOINT })) {
        for (const i of page.items) {
          const userId = ensureUser(db, i.user.login, i.user.id, i.user.avatar_url);
          recordEvent(db, repo.id, userId, "issue", i.created_at?.split("T")[0] || null, `issue-${i.number}`, JSON.stringify({ title: i.title }));
          queueEnrichment(db, i.user.login, "issue");
          issueCount++;
        }
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: issues collection stopped:`, err);
    }
    setCursor(db, "issues_since", repo.id, new Date().toISOString());
    console.log(`[engagement] ${owner}/${name}: ${issueCount} issues processed`);

    // PRs
    let prCount = 0;
    try {
      for await (const page of client.prPages(owner, name, { maxPages: 3 })) {
        for (const p of page.items) {
          const userId = ensureUser(db, p.user.login, p.user.id, p.user.avatar_url);
          recordEvent(db, repo.id, userId, "pr", p.created_at?.split("T")[0] || null, `pr-${p.number}`, JSON.stringify({ title: p.title }));
          queueEnrichment(db, p.user.login, "pr");
          prCount++;
        }
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: PRs collection stopped:`, err);
    }
    console.log(`[engagement] ${owner}/${name}: ${prCount} PRs processed`);

    // Commits (since last collection)
    const commitSince = getCursor(db, "commits_since", repo.id) || new Date(Date.now() - 90 * 86400000).toISOString();
    let commitCount = 0;
    try {
      for await (const page of client.commitPages(owner, name, commitSince, { maxPages: MAX_PAGES_PER_ENDPOINT })) {
        for (const c of page.items) {
          if (!c.author?.login) continue;
          const userId = ensureUser(db, c.author.login, c.author.id, c.author.avatar_url);
          recordEvent(db, repo.id, userId, "commit", c.commit.author.date?.split("T")[0] || null, c.sha, JSON.stringify({ email: c.commit.author.email }));
          queueEnrichment(db, c.author.login, "commit");
          commitCount++;
        }
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: commits collection stopped:`, err);
    }
    setCursor(db, "commits_since", repo.id, new Date().toISOString());
    console.log(`[engagement] ${owner}/${name}: ${commitCount} commits processed`);
  }
}
```

Deleted with this rewrite: the `getRateLimit()` skip-below-100 block at the top and the closing `getRateLimit()` log (the client's wait policy replaces both — AC #4).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (engagement, client, and pipeline tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collectors/github-engagement.ts src/lib/collectors/github-engagement.test.ts
git commit -m "refactor: engagement collector consumes client page iterators; delete skip-below-100"
```

---

### Task 4: Enrichment collector + delete the second client + definition cleanup

**Files:**
- Modify: `src/lib/collectors/github-user-enrichment.ts`
- Delete: `src/lib/api-clients/github-users-client.ts`
- Modify: `src/lib/pipeline/definition.ts`

- [ ] **Step 1: Update `src/lib/collectors/github-user-enrichment.ts`**

Replace:
```ts
import { getUserProfile, getUserOrgs, getRateLimit } from "../api-clients/github-users-client";
```
with:
```ts
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
```

Replace the signature and DELETE the entire dynamic batch-shrinking block (AC #4) — the function now starts:
```ts
export async function collectUserEnrichment(batchSize = 50, client: GithubClient = createGithubClient()) {
  const db = getDb();

  const pending = db.select().from(enrichmentQueue)
```
(i.e. the `getRateLimit()` call, the `needed`/`adjusted` computation, and the skip/reduce logging are all removed.)

Two call-site changes in the body:
- `await getUserProfile(item.userLogin)` → `await client.getUserProfile(item.userLogin)`
- `await getUserOrgs(item.userLogin)` → `await client.getUserOrgs(item.userLogin)`

- [ ] **Step 2: Delete the second client**

```bash
git rm src/lib/api-clients/github-users-client.ts
```

- [ ] **Step 3: Remove `requireGithubToken` from `src/lib/pipeline/definition.ts`**

The client constructor (evaluated in each collector's default parameter at call time) now throws the same typed `GithubAuthError` with an identical message — token is read in exactly one place. Delete the `requireGithubToken` function and simplify the four GitHub steps:

```ts
  {
    name: "github",
    dependsOn: ["config-sync"],
    run: () => collectGithubMetrics(),
  },
```
```ts
  {
    name: "events-auto",
    dependsOn: ["config-sync"],
    run: () => collectAutoEvents(),
  },
```
```ts
  {
    name: "github-engagement",
    dependsOn: ["config-sync"],
    run: () => collectGithubEngagement(),
  },
```
```ts
  {
    name: "github-user-enrichment",
    dependsOn: ["github-engagement"],
    run: () => collectUserEnrichment(50),
  },
```

- [ ] **Step 4: Verify tests, build, and the tokenless run still fails fast**

Run: `npm test && npm run build`
Expected: PASS / build succeeds.

Run: `env -u GITHUB_TOKEN DATABASE_PATH=$(mktemp -d)/x.db npm run collect; echo "exit=$?"`
Expected: github / events-auto / github-engagement `failed` with "GITHUB_TOKEN is not set"; chain skipped; npm/pypi/deps-dev succeed; `exit=1` (preserves orchestrator-PRD AC #2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collectors/github-user-enrichment.ts src/lib/pipeline/definition.ts
git rm --cached src/lib/api-clients/github-users-client.ts 2>/dev/null; git add -u src/lib/api-clients/
git commit -m "refactor: enrichment uses the client; delete batch-shrinking and second GitHub client"
```

---

### Task 5: CLAUDE.md + verify all acceptance criteria

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

In the architecture section, replace the sentence fragment "Each step lives in `src/lib/collectors/` and uses an API client from `src/lib/api-clients/`." (end of architecture point 1) with:

```markdown
Each step lives in `src/lib/collectors/`. ALL GitHub HTTP access goes through the single deep client `src/lib/api-clients/github-client.ts` (`createGithubClient` — owns auth, the one rate-limit wait policy, pagination iterators, typed `GithubApiError`/`GithubAuthError`); collectors accept an injected `GithubClient` for offline testing. Other registries use the simple clients in `src/lib/api-clients/`.
```

- [ ] **Step 2: AC #1 — one module performs GitHub HTTP access**

```bash
grep -rln "api.github.com" src/ | grep -v "api-clients/github-client"
grep -rln "x-ratelimit\|X-RateLimit" src/ | grep -v "api-clients/github-client"
```
Expected: no output from either.

- [ ] **Step 3: AC #2 — npm test**

Run: `npm test`
Expected: PASS, including rate-limit wait, pagination assembly, typed 500 error, and engagement-against-fake-client tests.

- [ ] **Step 4: AC #4 — deleted code paths**

```bash
grep -rn "getRateLimit\|Reduced batch\|Rate limit too low" src/lib/collectors/
```
Expected: no output.

- [ ] **Step 5: AC #5 — build and lint**

Run: `npm run build && npx eslint src/lib src/scripts`
Expected: build succeeds; no errors in touched directories (repo-wide lint still carries the 5 pre-existing dashboard-page errors documented in PR #11 — out of scope).

- [ ] **Step 6: AC #3 — real-token collect (if a token is available)**

If `.env.local` contains `GITHUB_TOKEN`:
```bash
set -a; source .env.local; set +a
DATABASE_PATH=$(mktemp -d)/ac3.db npm run collect; echo "exit=$?"
```
Expected: all GitHub steps `success` in the run summary; exit=0. If no token is available locally, note it and rely on the daily Action.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the single GitHub client in CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage:** Story 1/7 (one client, one token read) → Tasks 1+4; Story 2 (wait not skip) → Task 1 rate-limit policy + Task 3/4 deletions; Story 3 (typed resources) → Task 1 types; Story 4 (pagination inside client) → Task 1 `pages()` + Task 3; Story 5 (fake client) → Task 3 test; Story 6 (wait logged once with reset time) → Task 1 `console.warn` with ISO reset; Story 8 (typed errors with endpoint) → `GithubApiError`. AC1→Task 5 greps; AC2→Tasks 1+3; AC3→Task 5; AC4→Tasks 3+4; AC5→Task 5.
- **Stricter-of-two policy:** the sleeping behaviour (old threshold 10) wins; the warn-at-50 path, skip-below-100, and batch-shrinking are deleted. The old 60s wait cap is removed — the client now sleeps the full window per the PRD ("sleep until the reset timestamp").
- **Behaviour preserved:** stargazer cursor resume/reset semantics, `issues_since`/`commits_since`, PR `maxPages: 3`, issues PR-filtering, contributor-stats 202 retry, org detail fallback, per-endpoint catch-log-continue in engagement (resilience added by PRD #5 — not in this PRD's deletion list).
- **Behaviour intentionally changed:** the old users-client returned `[]` on 404; the new client throws `GithubApiError(404)` — enrichment's existing per-item catch handles it (marks attempt/failed), which is the diagnosable behaviour story 8 asks for.
- **Type consistency:** `GithubClient`, `Page<T>`, `PageOptions`, `createGithubClient(options)` used identically in Tasks 1–4; fake client in Task 3 implements the exact interface.
