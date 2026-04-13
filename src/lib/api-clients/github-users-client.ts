const GITHUB_API_BASE = "https://api.github.com";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "gtm-growth-tracker",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function githubFetch<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const url = `${GITHUB_API_BASE}${path}`;
  const resp = await fetch(url, { headers: { ...getHeaders(), ...extraHeaders } });

  const remaining = resp.headers.get("X-RateLimit-Remaining");
  if (remaining && parseInt(remaining) < 50) {
    console.warn(`[github-users] Rate limit low: ${remaining} remaining`);
  }

  if (!resp.ok) {
    if (resp.status === 404) return [] as unknown as T;
    throw new Error(`GitHub API error: ${resp.status} for ${path}`);
  }
  return resp.json();
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

export interface GithubOrg {
  login: string;
  description: string | null;
  url: string;
}

interface GithubOrgDetail {
  login: string;
  name: string | null;
  description: string | null;
  blog: string;
}

interface StargazerEntry {
  user: { login: string; id: number; avatar_url: string };
  starred_at: string;
}

interface ForkEntry {
  owner: { login: string; id: number; type: string; avatar_url: string };
  created_at: string;
}

interface IssueEntry {
  number: number;
  title: string;
  user: { login: string; id: number; avatar_url: string };
  created_at: string;
  pull_request?: unknown;
}

interface PREntry {
  number: number;
  title: string;
  user: { login: string; id: number; avatar_url: string };
  created_at: string;
}

interface CommitEntry {
  sha: string;
  author: { login: string; id: number; avatar_url: string } | null;
  commit: { author: { name: string; email: string; date: string } };
}

export async function getUserProfile(login: string): Promise<GithubUserProfile> {
  return githubFetch(`/users/${encodeURIComponent(login)}`);
}

export async function getUserOrgs(login: string): Promise<GithubOrgDetail[]> {
  const orgs = await githubFetch<GithubOrg[]>(`/users/${encodeURIComponent(login)}/orgs`);
  const details: GithubOrgDetail[] = [];
  for (const org of orgs.slice(0, 5)) {
    try {
      const detail = await githubFetch<GithubOrgDetail>(`/orgs/${encodeURIComponent(org.login)}`);
      details.push(detail);
    } catch {
      details.push({ login: org.login, name: null, description: org.description, blog: "" });
    }
  }
  return details;
}

export async function getStargazers(
  owner: string, repo: string, page: number, perPage = 100
): Promise<StargazerEntry[]> {
  return githubFetch(`/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`, {
    Accept: "application/vnd.github.star+json",
  });
}

export async function getForkers(
  owner: string, repo: string, page: number
): Promise<ForkEntry[]> {
  return githubFetch(`/repos/${owner}/${repo}/forks?sort=newest&per_page=100&page=${page}`);
}

export async function getRepoIssues(
  owner: string, repo: string, since: string, page: number
): Promise<IssueEntry[]> {
  const all = await githubFetch<IssueEntry[]>(
    `/repos/${owner}/${repo}/issues?state=all&since=${since}&sort=updated&per_page=100&page=${page}`
  );
  return all.filter((i) => !i.pull_request);
}

export async function getRepoPRs(
  owner: string, repo: string, page: number
): Promise<PREntry[]> {
  return githubFetch(`/repos/${owner}/${repo}/pulls?state=all&sort=updated&per_page=100&page=${page}`);
}

export async function getRepoCommits(
  owner: string, repo: string, since: string, page: number
): Promise<CommitEntry[]> {
  return githubFetch(`/repos/${owner}/${repo}/commits?since=${since}&per_page=100&page=${page}`);
}

export async function getRateLimit(): Promise<{ remaining: number; resetAt: Date }> {
  const data = await githubFetch<{ resources: { core: { remaining: number; reset: number } } }>(
    "/rate_limit"
  );
  return {
    remaining: data.resources.core.remaining,
    resetAt: new Date(data.resources.core.reset * 1000),
  };
}
