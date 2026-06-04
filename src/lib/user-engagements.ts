import { githubEngagementEvents, trackedRepos } from "./db/schema";
import { eventAnchorDate } from "./decay";
import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import type { EntityEngagement } from "./types/sales-intelligence";

/** A user's engagement broken down per entity (PRD #42): which repo, what
 *  they did there (scoring-style type buckets, raw counts), competitor
 *  attribution, and the newest event date — sorted newest first. Shared by
 *  the company-detail and People routes. */
export function entityEngagementsFor(db: Db, userId: number): EntityEngagement[] {
  const rows = db
    .select({
      owner: trackedRepos.owner,
      repoName: trackedRepos.name,
      displayName: trackedRepos.displayName,
      competitor: trackedRepos.competitor,
      eventType: githubEngagementEvents.eventType,
      eventDate: githubEngagementEvents.eventDate,
      collectedAt: githubEngagementEvents.collectedAt,
    })
    .from(githubEngagementEvents)
    .innerJoin(trackedRepos, sql`${githubEngagementEvents.repoId} = ${trackedRepos.id}`)
    .where(sql`${githubEngagementEvents.userId} = ${userId}`)
    .all();

  const byEntity = new Map<string, EntityEngagement>();
  for (const r of rows) {
    const entity = `${r.owner}/${r.repoName}`;
    let e = byEntity.get(entity);
    if (!e) {
      e = {
        entity,
        displayName: r.displayName,
        competitor: r.competitor,
        starCount: 0,
        forkCount: 0,
        issueCount: 0,
        prCount: 0,
        commitCount: 0,
        lastAt: null,
      };
      byEntity.set(entity, e);
    }
    // Scoring-style type buckets (issue comments count as issues, reviews as PRs)
    if (r.eventType === "star") e.starCount++;
    else if (r.eventType === "fork") e.forkCount++;
    else if (r.eventType === "issue" || r.eventType === "issue_comment") e.issueCount++;
    else if (r.eventType === "pr" || r.eventType === "pr_review") e.prCount++;
    else if (r.eventType === "commit") e.commitCount++;
    const anchor = eventAnchorDate(r.eventDate, r.collectedAt);
    if (!e.lastAt || anchor > e.lastAt) e.lastAt = anchor;
  }
  return [...byEntity.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}
