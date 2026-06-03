import fs from "fs";
import path from "path";
import { getDb } from "../db/client";
import { trackedRepos, githubUsers } from "../db/schema";
import { readConfig, type GtmConfig } from "../config/gtm-config";
import { sql, isNotNull } from "drizzle-orm";

/**
 * Competitor-employee tagging (PRD #17, issue #23) — three overlapping
 * best-effort signals, applied in precedence order with first-write-wins:
 *   1. commit_activity — commit/PR/PR-review events on a competitor repo
 *   2. org_membership  — membership in the GitHub org owning a competitor repo
 *   3. domain_match    — resolved company domain in the configured
 *                        `competitors:` block (absent block → signals 1–2 only)
 * Tagging is additive metadata: a user is tagged once, never overwritten,
 * never deleted. Runs at the end of company-resolution — NOT a separate
 * pipeline step.
 */
export async function tagCompetitorEmployees(config?: GtmConfig) {
  const db = getDb();

  let resolvedConfig = config;
  if (!resolvedConfig) {
    const configPath = path.join(process.cwd(), "gtm-config.yaml");
    resolvedConfig = fs.existsSync(configPath) ? readConfig(configPath) : undefined;
  }

  const competitorRepos = db
    .select()
    .from(trackedRepos)
    .where(isNotNull(trackedRepos.competitor))
    .all();

  let tagged = 0;

  // Signal 1: supply-side activity on a competitor repo identifies its team.
  for (const repo of competitorRepos) {
    const result = db
      .update(githubUsers)
      .set({ competitorEmployee: repo.competitor!, competitorEmployeeSource: "commit_activity" })
      .where(
        sql`${githubUsers.competitorEmployee} IS NULL AND ${githubUsers.id} IN (
          SELECT user_id FROM github_engagement_events
          WHERE repo_id = ${repo.id} AND event_type IN ('commit', 'pr', 'pr_review')
        )`
      )
      .run();
    tagged += result.changes;
  }

  // Signal 2: public membership in the org that owns a competitor repo.
  for (const repo of competitorRepos) {
    const result = db
      .update(githubUsers)
      .set({ competitorEmployee: repo.competitor!, competitorEmployeeSource: "org_membership" })
      .where(
        sql`${githubUsers.competitorEmployee} IS NULL AND ${githubUsers.id} IN (
          SELECT user_id FROM github_user_orgs WHERE LOWER(org_login) = LOWER(${repo.owner})
        )`
      )
      .run();
    tagged += result.changes;
  }

  // Signal 3: resolved company domain matches a configured competitor domain.
  for (const [competitor, entry] of Object.entries(resolvedConfig?.competitors ?? {})) {
    for (const domain of entry.domains) {
      const result = db
        .update(githubUsers)
        .set({ competitorEmployee: competitor, competitorEmployeeSource: "domain_match" })
        .where(
          sql`${githubUsers.competitorEmployee} IS NULL AND ${githubUsers.id} IN (
            SELECT guc.user_id FROM github_user_companies guc
            JOIN companies c ON c.id = guc.company_id
            WHERE c.domain = ${domain}
          )`
        )
        .run();
      tagged += result.changes;
    }
  }

  console.log(`[competitor-employees] Tagged ${tagged} users`);
}
