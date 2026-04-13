const GITHUB_API_BASE = "https://api.github.com";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "gtm-growth-tracker",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch<T>(path: string): Promise<T> {
  const url = `${GITHUB_API_BASE}${path}`;
  const resp = await fetch(url, { headers: getHeaders() });

  // Check rate limits
  const remaining = resp.headers.get("X-RateLimit-Remaining");
  if (remaining && parseInt(remaining) < 10) {
    const resetTime = resp.headers.get("X-RateLimit-Reset");
    if (resetTime) {
      const waitMs = parseInt(resetTime) * 1000 - Date.now();
      if (waitMs > 0 && waitMs < 60000) {
        console.warn(`GitHub rate limit low (${remaining}), waiting ${Math.ceil(waitMs / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  if (!resp.ok) {
    if (resp.status === 403 && remaining === "0") {
      throw new Error("GitHub API rate limit exceeded");
    }
    throw new Error(`GitHub API error: ${resp.status} ${resp.statusText} for ${path}`);
  }

  return resp.json();
}

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

export async function getRepo(owner: string, name: string): Promise<GithubRepoData> {
  return githubFetch(`/repos/${owner}/${name}`);
}

export async function getTrafficClones(owner: string, name: string): Promise<GithubTrafficClones> {
  return githubFetch(`/repos/${owner}/${name}/traffic/clones`);
}

export async function getTrafficViews(owner: string, name: string): Promise<GithubTrafficViews> {
  return githubFetch(`/repos/${owner}/${name}/traffic/views`);
}

export async function getReleases(owner: string, name: string): Promise<GithubRelease[]> {
  // Fetch up to 100 releases
  return githubFetch(`/repos/${owner}/${name}/releases?per_page=100`);
}

export async function getContributorStats(
  owner: string,
  name: string
): Promise<GithubContributorStat[]> {
  // This endpoint may return 202 (computing) — retry
  for (let i = 0; i < 3; i++) {
    try {
      const result = await githubFetch<GithubContributorStat[]>(
        `/repos/${owner}/${name}/stats/contributors`
      );
      return result;
    } catch {
      if (i < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return [];
}
