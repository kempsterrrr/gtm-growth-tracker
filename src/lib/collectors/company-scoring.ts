import fs from "fs";
import path from "path";
import { getDb } from "../db/client";
import {
  companies, githubUserCompanies, githubEngagementEvents, companyScores, trackedRepos,
  companyCompetitorSignals, githubUsers, trackedPackages,
} from "../db/schema";
import {
  ENGAGEMENT_WEIGHTS, COMPETITOR_ENGAGEMENT_WEIGHTS, BREADTH_BONUS_PER_USER, MAX_EVENTS_PER_TYPE,
  DEPENDS_ON_WEIGHT,
} from "../types/scoring";
import { readConfig, resolveScoringKnobs, type GtmConfig } from "../config/gtm-config";
import {
  decayMultiplier,
  eventAgeDays,
  eventAnchorDate,
  DECAY_HALF_LIFE_DAYS,
  DECAY_MAX_AGE_DAYS,
  MIN_AGGREGATE_SCORE,
} from "../decay";
import { sql } from "drizzle-orm";
import type { EngagementEventType } from "../types/sales-intelligence";
import { todayIso } from "../dates";

/** Recency knobs — parameterized so issue #37 can thread configured values;
 *  the defaults are the grilled PRD #34 numbers. */
export interface ScoringKnobs {
  halfLifeDays?: number;
  maxAgeDays?: number;
  minAggregateScore?: number;
}

/** Graceful config read (the config module stays the only YAML reader):
 *  undefined when the file is missing or malformed — config-sync already
 *  failed the run loudly in the malformed case; scoring degrades to defaults. */
function loadConfigGracefully(): GtmConfig | undefined {
  const configPath = path.join(process.cwd(), "gtm-config.yaml");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    return readConfig(configPath);
  } catch {
    return undefined;
  }
}

type ScoreScope = "own" | "competitor";

interface ScopeTotals {
  score: number;
  users: number;
  stars: number;
  forks: number;
  issues: number;
  prs: number;
  commits: number;
  /** Newest event anchor date aggregated into this scope (ISO, nullable). */
  lastEvent: string | null;
}

const emptyTotals = (): ScopeTotals => ({
  score: 0, users: 0, stars: 0, forks: 0, issues: 0, prs: 0, commits: 0, lastEvent: null,
});

export async function scoreCompanies(knobs: ScoringKnobs = {}) {
  const config = loadConfigGracefully();
  // Explicit knobs (tests) > configured scoring block (Settings) > defaults.
  const configured = resolveScoringKnobs(config?.scoring);
  const halfLife = knobs.halfLifeDays ?? configured.halfLifeDays;
  const maxAge = knobs.maxAgeDays ?? configured.maxAgeDays;
  const minScore = knobs.minAggregateScore ?? configured.minAggregateScore;
  const db = getDb();
  const today = todayIso();
  const allCompanies = db.select().from(companies).all();
  const allRepos = db.select().from(trackedRepos).all();

  // Tagged competitor employees: excluded from competitor-scope aggregation
  // (their own-side engagement still counts — "competitor is watching us"
  // stays visible; issue #23).
  const taggedUserIds = new Set(
    db
      .select({ id: githubUsers.id })
      .from(githubUsers)
      .where(sql`${githubUsers.competitorEmployee} IS NOT NULL`)
      .all()
      .map((r) => r.id)
  );

  // The competitor's own company never ranks as its own prospect: identify it
  // by tracked competitor name (case-insensitive) or configured domain.
  const competitorNames = new Set(
    allRepos
      .map((r) => r.competitor)
      .filter((c): c is string => c != null)
      .map((c) => c.toLowerCase())
  );
  const competitorPkgs = db
    .select({ competitor: trackedPackages.competitor })
    .from(trackedPackages)
    .where(sql`${trackedPackages.competitor} IS NOT NULL`)
    .all();
  for (const p of competitorPkgs) competitorNames.add(p.competitor!.toLowerCase());
  const competitorDomains = new Set(
    Object.values(config?.competitors ?? {}).flatMap((c) => c.domains)
  );
  const isCompetitorCompany = (company: { name: string; domain: string | null }) =>
    competitorNames.has(company.name.toLowerCase()) ||
    (company.domain != null && competitorDomains.has(company.domain));

  let scored = 0;

  for (const company of allCompanies) {
    // Get all users linked to this company
    const userLinks = db.select().from(githubUserCompanies)
      .where(sql`${githubUserCompanies.companyId} = ${company.id}`)
      .all();

    // Depends-on-competitor signals (issue #22): the strongest prospect
    // signal, capped per package like engagement types. Companies with
    // signals but no linked users still get scored (net-new prospects from
    // package dependents alone).
    const signalCounts = db
      .select({
        packageId: companyCompetitorSignals.packageId,
        n: sql<number>`COUNT(*)`,
      })
      .from(companyCompetitorSignals)
      .where(sql`${companyCompetitorSignals.companyId} = ${company.id}`)
      .groupBy(companyCompetitorSignals.packageId)
      .all();

    if (userLinks.length === 0 && signalCounts.length === 0) continue;
    const userIds = userLinks.map((u) => u.userId);

    // Two aggregates that never blend: own-engagement and competitor-engagement
    const totals: Record<ScoreScope, ScopeTotals> = {
      own: emptyTotals(),
      competitor: emptyTotals(),
    };

    for (const repo of allRepos) {
      // Signal semantics flip on competitor repos — the weight table is
      // selected per repo from its attribution.
      const scope: ScoreScope = repo.competitor ? "competitor" : "own";
      const weights = repo.competitor ? COMPETITOR_ENGAGEMENT_WEIGHTS : ENGAGEMENT_WEIGHTS;

      let repoScore = 0;
      let repoUsers = 0;
      let repoStars = 0, repoForks = 0, repoIssues = 0, repoPrs = 0, repoCommits = 0;
      let repoLastEvent: string | null = null;

      for (const userId of userIds) {
        // Competitor employees never contribute to competitor-scope scores.
        if (scope === "competitor" && taggedUserIds.has(userId)) continue;
        // Individual events (newest first) — recency decay needs each
        // event's age, not just per-type counts.
        const events = db.select({
          eventType: githubEngagementEvents.eventType,
          eventDate: githubEngagementEvents.eventDate,
          collectedAt: githubEngagementEvents.collectedAt,
        })
          .from(githubEngagementEvents)
          .where(sql`${githubEngagementEvents.userId} = ${userId} AND ${githubEngagementEvents.repoId} = ${repo.id}`)
          .orderBy(sql`${githubEngagementEvents.eventDate} IS NULL, ${githubEngagementEvents.eventDate} DESC`)
          .all();

        if (events.length === 0) continue;

        // The per-type cap keeps the MOST RECENT events (best possible value
        // under decay), preserving the old cap's anti-spam intent.
        const byType = new Map<EngagementEventType, typeof events>();
        for (const e of events) {
          const type = e.eventType as EngagementEventType;
          if (!byType.has(type)) byType.set(type, []);
          byType.get(type)!.push(e);
        }

        let userScore = 0;
        for (const [type, typeEvents] of byType) {
          const weight = weights[type] || 0;
          const kept = typeEvents.slice(0, MAX_EVENTS_PER_TYPE);
          for (const e of kept) {
            const age = eventAgeDays(e.eventDate, e.collectedAt, today);
            userScore += weight * decayMultiplier(age, halfLife, maxAge);
            const anchor = eventAnchorDate(e.eventDate, e.collectedAt);
            if (!repoLastEvent || anchor > repoLastEvent) repoLastEvent = anchor;
          }
          const capped = kept.length;

          // Track type counts (raw facts, recorded regardless of decay)
          if (type === "star") repoStars += capped;
          else if (type === "fork") repoForks += capped;
          else if (type === "issue" || type === "issue_comment") repoIssues += capped;
          else if (type === "pr" || type === "pr_review") repoPrs += capped;
          else if (type === "commit") repoCommits += capped;
        }
        // Only score-carrying users count toward breadth — on own repos this
        // is a no-op (every own weight ≥ 1); on competitor repos it keeps
        // supply-signal-only users (commits/PRs — the competitor's own team)
        // from inflating prospect scores via the breadth bonus.
        if (userScore > 0) repoUsers++;
        repoScore += userScore;
      }

      if (repoUsers > 0) {
        repoScore += repoUsers * BREADTH_BONUS_PER_USER;

        // Save per-repo score (scope stamped from the repo's attribution)
        db.insert(companyScores)
          .values({
            companyId: company.id, repoId: repo.id, scope, date: today,
            score: repoScore, userCount: repoUsers, lastEventDate: repoLastEvent,
            starCount: repoStars, forkCount: repoForks,
            issueCount: repoIssues, prCount: repoPrs, commitCount: repoCommits,
          })
          .onConflictDoUpdate({
            target: [companyScores.companyId, companyScores.repoId, companyScores.date],
            set: {
              scope: sql`excluded.scope`,
              score: sql`excluded.score`, userCount: sql`excluded.user_count`,
              lastEventDate: sql`excluded.last_event_date`,
              starCount: sql`excluded.star_count`, forkCount: sql`excluded.fork_count`,
              issueCount: sql`excluded.issue_count`, prCount: sql`excluded.pr_count`,
              commitCount: sql`excluded.commit_count`,
            },
          })
          .run();
      }

      const t = totals[scope];
      t.score += repoScore;
      t.users = Math.max(t.users, repoUsers);
      t.stars += repoStars; t.forks += repoForks;
      t.issues += repoIssues; t.prs += repoPrs; t.commits += repoCommits;
      if (repoLastEvent && (!t.lastEvent || repoLastEvent > t.lastEvent)) {
        t.lastEvent = repoLastEvent;
      }
    }

    for (const s of signalCounts) {
      totals.competitor.score += Math.min(s.n, MAX_EVENTS_PER_TYPE) * DEPENDS_ON_WEIGHT;
    }

    // Aggregate rows (repo_id NULL): delete-then-insert. SQLite treats NULLs
    // as distinct in the (company_id, repo_id, date) unique index, so the old
    // upsert never conflicted and same-day re-runs duplicated aggregates —
    // replacing the day's rows fixes that and gives one row per scope. The
    // delete runs unconditionally so a same-day rescore under stricter knobs
    // clears rows that no longer meet the floor.
    db.delete(companyScores)
      .where(
        sql`${companyScores.companyId} = ${company.id} AND ${companyScores.repoId} IS NULL AND ${companyScores.date} = ${today}`
      )
      .run();
    let wrote = false;
    for (const scope of ["own", "competitor"] as const) {
      const t = totals[scope];
      // Below the floor = no signal: no row, and the segment drops (PRD #34).
      if (t.score < minScore) continue;
      // The competitor itself gets no competitor aggregate — it must never
      // surface as its own prospect or battleground.
      if (scope === "competitor" && isCompetitorCompany(company)) continue;
      db.insert(companyScores)
        .values({
          companyId: company.id, repoId: null, scope, date: today,
          score: t.score, userCount: t.users, lastEventDate: t.lastEvent,
          starCount: t.stars, forkCount: t.forks,
          issueCount: t.issues, prCount: t.prs, commitCount: t.commits,
        })
        .run();
      wrote = true;
    }
    if (wrote) scored++;
  }

  console.log(`[scoring] Scored ${scored} companies`);
}
