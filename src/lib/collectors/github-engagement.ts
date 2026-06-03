import { getDb } from "../db/client";
import { trackedRepos, githubUsers, githubEngagementEvents, enrichmentQueue, collectionCursors } from "../db/schema";
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
import { ENRICHMENT_PRIORITY, COMPETITOR_PRIORITY_OFFSET } from "../types/scoring";
import { sql } from "drizzle-orm";
import type { EngagementEventType } from "../types/sales-intelligence";

const MAX_PAGES_PER_ENDPOINT = 5;
// First collection of a competitor repo backfills full engagement history so
// the prospect list is complete immediately (PRD #17). Sized for the PRD's
// mid-size competitor assumption (~5k stars); the star cursor resumes across
// runs if a repo exceeds it. Commits stay on the incremental window — they
// are a weight-0 employee signal (#23), not prospect signal.
const BACKFILL_MAX_PAGES = 60;
const BACKFILL_PR_MAX_PAGES = 20;
// Full-history floor for the /issues `since` param. NOT the unix epoch:
// GitHub silently returns an empty result set for since=1970-01-01 (verified
// live) — use GitHub's founding year, which nothing on the platform predates.
const BACKFILL_SINCE_ISO = "2008-01-01T00:00:00Z";

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

function queueEnrichment(
  db: ReturnType<typeof getDb>,
  login: string,
  eventType: EngagementEventType,
  competitor: boolean
) {
  // Own-repo users always outrank competitor-repo users in the queue; the
  // MAX() upsert lifts anyone who later engages our own repos.
  const priority = ENRICHMENT_PRIORITY[eventType] + (competitor ? COMPETITOR_PRIORITY_OFFSET : 0);
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
    const isCompetitor = repo.competitor != null;
    const backfill = isCompetitor && !getCursor(db, "backfilled", repo.id);
    const listMaxPages = backfill ? BACKFILL_MAX_PAGES : MAX_PAGES_PER_ENDPOINT;
    console.log(
      `[engagement] Collecting ${owner}/${name}...${backfill ? " (competitor full-history backfill)" : ""}`
    );

    // Stars (resumable page cursor)
    const starPage = parseInt(getCursor(db, "stargazers", repo.id) || "1");
    let starCount = 0;
    try {
      for await (const page of client.stargazerPages(owner, name, {
        startPage: starPage,
        maxPages: listMaxPages,
      })) {
        for (const s of page.items) {
          const userId = ensureUser(db, s.user.login, s.user.id, s.user.avatar_url);
          recordEvent(db, repo.id, userId, "star", s.starred_at?.split("T")[0] || null, "star");
          queueEnrichment(db, s.user.login, "star", isCompetitor);
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
      for await (const page of client.forkPages(owner, name, { maxPages: listMaxPages })) {
        for (const f of page.items) {
          const userId = ensureUser(db, f.owner.login, f.owner.id, f.owner.avatar_url);
          recordEvent(db, repo.id, userId, "fork", f.created_at?.split("T")[0] || null, `fork-${f.owner.login}`);
          queueEnrichment(db, f.owner.login, "fork", isCompetitor);
          forkCount++;
        }
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: forks collection stopped:`, err);
    }
    console.log(`[engagement] ${owner}/${name}: ${forkCount} forks processed`);

    // Issues (since last collection; full history on a competitor's first run)
    const issueSince =
      getCursor(db, "issues_since", repo.id) ||
      (backfill ? BACKFILL_SINCE_ISO : new Date(Date.now() - 90 * 86400000).toISOString());
    let issueCount = 0;
    try {
      // listMaxPages here matters more than for stars: /issues mixes PRs in,
      // so on PR-heavy repos a shallow cap is consumed by PR rows before any
      // true issue (the highest-weight prospect signal) is reached.
      for await (const page of client.issuePages(owner, name, issueSince, { maxPages: listMaxPages })) {
        for (const i of page.items) {
          const userId = ensureUser(db, i.user.login, i.user.id, i.user.avatar_url);
          recordEvent(db, repo.id, userId, "issue", i.created_at?.split("T")[0] || null, `issue-${i.number}`, JSON.stringify({ title: i.title }));
          queueEnrichment(db, i.user.login, "issue", isCompetitor);
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
      for await (const page of client.prPages(owner, name, {
        maxPages: backfill ? BACKFILL_PR_MAX_PAGES : 3,
      })) {
        for (const p of page.items) {
          const userId = ensureUser(db, p.user.login, p.user.id, p.user.avatar_url);
          recordEvent(db, repo.id, userId, "pr", p.created_at?.split("T")[0] || null, `pr-${p.number}`, JSON.stringify({ title: p.title }));
          queueEnrichment(db, p.user.login, "pr", isCompetitor);
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
          queueEnrichment(db, c.author.login, "commit", isCompetitor);
          commitCount++;
        }
      }
    } catch (err) {
      console.warn(`[engagement] ${owner}/${name}: commits collection stopped:`, err);
    }
    setCursor(db, "commits_since", repo.id, new Date().toISOString());
    console.log(`[engagement] ${owner}/${name}: ${commitCount} commits processed`);

    if (backfill) setCursor(db, "backfilled", repo.id, "1");
  }
}
