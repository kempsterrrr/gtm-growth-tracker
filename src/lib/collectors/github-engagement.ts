import { getDb } from "../db/client";
import { trackedRepos, githubUsers, githubEngagementEvents, enrichmentQueue, collectionCursors } from "../db/schema";
import {
  getStargazers, getForkers, getRepoIssues, getRepoPRs, getRepoCommits, getRateLimit,
} from "../api-clients/github-users-client";
import { ENRICHMENT_PRIORITY } from "../types/scoring";
import { sql } from "drizzle-orm";
import type { EngagementEventType } from "../types/sales-intelligence";

const MAX_PAGES_PER_ENDPOINT = 5;

function ensureUser(db: ReturnType<typeof getDb>, login: string, githubId?: number, avatarUrl?: string): number {
  db.insert(githubUsers)
    .values({ login, githubId: githubId || null, avatarUrl: avatarUrl || null })
    .onConflictDoNothing()
    .run();
  const user = db.select().from(githubUsers).where(sql`${githubUsers.login} = ${login}`).get();
  return user!.id;
}

function recordEvent(
  db: ReturnType<typeof getDb>,
  repoId: number, userId: number,
  eventType: EngagementEventType, eventDate: string | null,
  githubEventId: string, metadata?: string
) {
  db.insert(githubEngagementEvents)
    .values({ repoId, userId, eventType, eventDate, githubEventId, metadata })
    .onConflictDoNothing()
    .run();
}

function queueEnrichment(db: ReturnType<typeof getDb>, login: string, eventType: EngagementEventType) {
  const priority = ENRICHMENT_PRIORITY[eventType];
  db.insert(enrichmentQueue)
    .values({ userLogin: login, priority, status: "pending" })
    .onConflictDoUpdate({
      target: [enrichmentQueue.userLogin],
      set: {
        priority: sql`MAX(${enrichmentQueue.priority}, ${priority})`,
        status: sql`CASE WHEN ${enrichmentQueue.status} = 'done' THEN 'done' ELSE 'pending' END`,
      },
    })
    .run();
}

function getCursor(db: ReturnType<typeof getDb>, cursorType: string, repoId: number): string | null {
  const row = db.select().from(collectionCursors)
    .where(sql`${collectionCursors.cursorType} = ${cursorType} AND ${collectionCursors.repoId} = ${repoId}`)
    .get();
  return row?.cursorValue || null;
}

function setCursor(db: ReturnType<typeof getDb>, cursorType: string, repoId: number, value: string) {
  db.insert(collectionCursors)
    .values({ cursorType, repoId, cursorValue: value })
    .onConflictDoUpdate({
      target: [collectionCursors.cursorType, collectionCursors.repoId],
      set: { cursorValue: sql`${value}`, updatedAt: sql`datetime('now')` },
    })
    .run();
}

export async function collectGithubEngagement() {
  const db = getDb();
  const repos = db.select().from(trackedRepos).all();

  if (repos.length === 0) {
    console.log("[engagement] No repos to collect");
    return;
  }

  const rateLimit = await getRateLimit();
  console.log(`[engagement] Rate limit: ${rateLimit.remaining} remaining`);
  if (rateLimit.remaining < 100) {
    console.warn("[engagement] Rate limit too low, skipping engagement collection");
    return;
  }

  for (const repo of repos) {
    const owner = repo.owner;
    const name = repo.name;
    console.log(`[engagement] Collecting ${owner}/${name}...`);

    // Stars
    const starPage = parseInt(getCursor(db, "stargazers", repo.id) || "1");
    let starCount = 0;
    for (let page = starPage; page < starPage + MAX_PAGES_PER_ENDPOINT; page++) {
      try {
        const stars = await getStargazers(owner, name, page);
        if (stars.length === 0) break;
        for (const s of stars) {
          const userId = ensureUser(db, s.user.login, s.user.id, s.user.avatar_url);
          recordEvent(db, repo.id, userId, "star", s.starred_at?.split("T")[0] || null, "star");
          queueEnrichment(db, s.user.login, "star");
          starCount++;
        }
        if (stars.length < 100) { setCursor(db, "stargazers", repo.id, "1"); break; }
        setCursor(db, "stargazers", repo.id, String(page + 1));
      } catch { break; }
    }
    console.log(`[engagement] ${owner}/${name}: ${starCount} stargazers processed`);

    // Forks
    let forkCount = 0;
    for (let page = 1; page <= MAX_PAGES_PER_ENDPOINT; page++) {
      try {
        const forks = await getForkers(owner, name, page);
        if (forks.length === 0) break;
        for (const f of forks) {
          const userId = ensureUser(db, f.owner.login, f.owner.id, f.owner.avatar_url);
          recordEvent(db, repo.id, userId, "fork", f.created_at?.split("T")[0] || null, `fork-${f.owner.login}`);
          queueEnrichment(db, f.owner.login, "fork");
          forkCount++;
        }
        if (forks.length < 100) break;
      } catch { break; }
    }
    console.log(`[engagement] ${owner}/${name}: ${forkCount} forks processed`);

    // Issues (since last collection)
    const issueSince = getCursor(db, "issues_since", repo.id) || new Date(Date.now() - 90 * 86400000).toISOString();
    let issueCount = 0;
    for (let page = 1; page <= MAX_PAGES_PER_ENDPOINT; page++) {
      try {
        const issues = await getRepoIssues(owner, name, issueSince, page);
        if (issues.length === 0) break;
        for (const i of issues) {
          const userId = ensureUser(db, i.user.login, i.user.id, i.user.avatar_url);
          recordEvent(db, repo.id, userId, "issue", i.created_at?.split("T")[0] || null, `issue-${i.number}`, JSON.stringify({ title: i.title }));
          queueEnrichment(db, i.user.login, "issue");
          issueCount++;
        }
        if (issues.length < 100) break;
      } catch { break; }
    }
    setCursor(db, "issues_since", repo.id, new Date().toISOString());
    console.log(`[engagement] ${owner}/${name}: ${issueCount} issues processed`);

    // PRs
    let prCount = 0;
    for (let page = 1; page <= 3; page++) {
      try {
        const prs = await getRepoPRs(owner, name, page);
        if (prs.length === 0) break;
        for (const p of prs) {
          const userId = ensureUser(db, p.user.login, p.user.id, p.user.avatar_url);
          recordEvent(db, repo.id, userId, "pr", p.created_at?.split("T")[0] || null, `pr-${p.number}`, JSON.stringify({ title: p.title }));
          queueEnrichment(db, p.user.login, "pr");
          prCount++;
        }
        if (prs.length < 100) break;
      } catch { break; }
    }
    console.log(`[engagement] ${owner}/${name}: ${prCount} PRs processed`);

    // Commits
    const commitSince = getCursor(db, "commits_since", repo.id) || new Date(Date.now() - 90 * 86400000).toISOString();
    let commitCount = 0;
    for (let page = 1; page <= MAX_PAGES_PER_ENDPOINT; page++) {
      try {
        const commits = await getRepoCommits(owner, name, commitSince, page);
        if (commits.length === 0) break;
        for (const c of commits) {
          if (!c.author?.login) continue;
          const userId = ensureUser(db, c.author.login, c.author.id, c.author.avatar_url);
          recordEvent(db, repo.id, userId, "commit", c.commit.author.date?.split("T")[0] || null, c.sha, JSON.stringify({ email: c.commit.author.email }));
          queueEnrichment(db, c.author.login, "commit");
          commitCount++;
        }
        if (commits.length < 100) break;
      } catch { break; }
    }
    setCursor(db, "commits_since", repo.id, new Date().toISOString());
    console.log(`[engagement] ${owner}/${name}: ${commitCount} commits processed`);
  }

  const finalRate = await getRateLimit();
  console.log(`[engagement] Done. Rate limit: ${finalRate.remaining} remaining`);
}
