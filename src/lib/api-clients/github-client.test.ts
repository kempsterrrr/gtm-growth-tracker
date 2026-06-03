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

/** fetch stub fed by a queue of responses */
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
