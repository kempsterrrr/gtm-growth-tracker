import { getDb } from "../db/client";
import {
  companies, githubUserCompanies, githubEngagementEvents, companyScores, trackedRepos,
} from "../db/schema";
import { ENGAGEMENT_WEIGHTS, BREADTH_BONUS_PER_USER, MAX_EVENTS_PER_TYPE } from "../types/scoring";
import { sql } from "drizzle-orm";
import type { EngagementEventType } from "../types/sales-intelligence";

export async function scoreCompanies() {
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];
  const allCompanies = db.select().from(companies).all();
  const allRepos = db.select().from(trackedRepos).all();

  let scored = 0;

  for (const company of allCompanies) {
    // Get all users linked to this company
    const userLinks = db.select().from(githubUserCompanies)
      .where(sql`${githubUserCompanies.companyId} = ${company.id}`)
      .all();

    if (userLinks.length === 0) continue;
    const userIds = userLinks.map((u) => u.userId);

    // Aggregate score across all repos
    let totalScore = 0;
    let totalUsers = 0;
    let totalStars = 0, totalForks = 0, totalIssues = 0, totalPrs = 0, totalCommits = 0;

    for (const repo of allRepos) {
      let repoScore = 0;
      let repoUsers = 0;
      let repoStars = 0, repoForks = 0, repoIssues = 0, repoPrs = 0, repoCommits = 0;

      for (const userId of userIds) {
        // Get engagement events for this user on this repo
        const events = db.select({
          eventType: githubEngagementEvents.eventType,
          count: sql<number>`COUNT(*)`,
        })
          .from(githubEngagementEvents)
          .where(sql`${githubEngagementEvents.userId} = ${userId} AND ${githubEngagementEvents.repoId} = ${repo.id}`)
          .groupBy(githubEngagementEvents.eventType)
          .all();

        if (events.length === 0) continue;
        repoUsers++;

        let userScore = 0;
        for (const e of events) {
          const type = e.eventType as EngagementEventType;
          const weight = ENGAGEMENT_WEIGHTS[type] || 0;
          const capped = Math.min(e.count, MAX_EVENTS_PER_TYPE);
          userScore += capped * weight;

          // Track type counts
          if (type === "star") repoStars += capped;
          else if (type === "fork") repoForks += capped;
          else if (type === "issue" || type === "issue_comment") repoIssues += capped;
          else if (type === "pr" || type === "pr_review") repoPrs += capped;
          else if (type === "commit") repoCommits += capped;
        }
        repoScore += userScore;
      }

      if (repoUsers > 0) {
        repoScore += repoUsers * BREADTH_BONUS_PER_USER;

        // Save per-repo score
        db.insert(companyScores)
          .values({
            companyId: company.id, repoId: repo.id, date: today,
            score: repoScore, userCount: repoUsers,
            starCount: repoStars, forkCount: repoForks,
            issueCount: repoIssues, prCount: repoPrs, commitCount: repoCommits,
          })
          .onConflictDoUpdate({
            target: [companyScores.companyId, companyScores.repoId, companyScores.date],
            set: {
              score: sql`excluded.score`, userCount: sql`excluded.user_count`,
              starCount: sql`excluded.star_count`, forkCount: sql`excluded.fork_count`,
              issueCount: sql`excluded.issue_count`, prCount: sql`excluded.pr_count`,
              commitCount: sql`excluded.commit_count`,
            },
          })
          .run();
      }

      totalScore += repoScore;
      totalUsers = Math.max(totalUsers, repoUsers);
      totalStars += repoStars; totalForks += repoForks;
      totalIssues += repoIssues; totalPrs += repoPrs; totalCommits += repoCommits;
    }

    if (totalScore > 0) {
      // Save aggregate score (repo_id = NULL)
      db.insert(companyScores)
        .values({
          companyId: company.id, repoId: null, date: today,
          score: totalScore, userCount: totalUsers,
          starCount: totalStars, forkCount: totalForks,
          issueCount: totalIssues, prCount: totalPrs, commitCount: totalCommits,
        })
        .onConflictDoUpdate({
          target: [companyScores.companyId, companyScores.repoId, companyScores.date],
          set: {
            score: sql`excluded.score`, userCount: sql`excluded.user_count`,
            starCount: sql`excluded.star_count`, forkCount: sql`excluded.fork_count`,
            issueCount: sql`excluded.issue_count`, prCount: sql`excluded.pr_count`,
            commitCount: sql`excluded.commit_count`,
          },
        })
        .run();
      scored++;
    }
  }

  console.log(`[scoring] Scored ${scored} companies`);
}
