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
