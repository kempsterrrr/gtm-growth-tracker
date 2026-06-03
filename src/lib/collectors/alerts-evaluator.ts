import { getDb } from "../db/client";
import {
  alertRules, alertEvents, companyScores, companies, githubUserEmails,
  trackedRepos, trackedPackages, githubUsers, githubEngagementEvents, companyCompetitorSignals,
} from "../db/schema";
import { sql } from "drizzle-orm";
import type { AlertRuleConfig } from "../types/sales-intelligence";
import { todayIso, daysAgoIso } from "../dates";

/** The competitor name behind a company's competitor score: highest latest
 *  per-repo row first, depends-on signals as fallback. Null when nothing is
 *  attributable (e.g. stale attribution). */
function topCompetitorFor(db: ReturnType<typeof getDb>, companyId: number): string | null {
  const repoRow = db
    .select({ competitor: trackedRepos.competitor })
    .from(companyScores)
    .innerJoin(trackedRepos, sql`${companyScores.repoId} = ${trackedRepos.id}`)
    .where(
      sql`${companyScores.companyId} = ${companyId} AND ${companyScores.scope} = 'competitor' AND ${trackedRepos.competitor} IS NOT NULL AND ${companyScores.date} = (
        SELECT MAX(date) FROM company_scores cs2
        WHERE cs2.company_id = ${companyScores.companyId} AND cs2.repo_id = ${companyScores.repoId} AND cs2.scope = 'competitor'
      )`
    )
    .orderBy(sql`${companyScores.score} DESC`)
    .limit(1)
    .get();
  if (repoRow?.competitor) return repoRow.competitor;

  const sigRow = db
    .select({ competitor: trackedPackages.competitor })
    .from(companyCompetitorSignals)
    .innerJoin(trackedPackages, sql`${companyCompetitorSignals.packageId} = ${trackedPackages.id}`)
    .where(
      sql`${companyCompetitorSignals.companyId} = ${companyId} AND ${trackedPackages.competitor} IS NOT NULL`
    )
    .groupBy(trackedPackages.competitor)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(1)
    .get();
  return sigRow?.competitor ?? null;
}

export async function evaluateAlerts() {
  const db = getDb();
  const rules = db.select().from(alertRules).where(sql`${alertRules.enabled} = 1`).all();

  if (rules.length === 0) return;

  const today = todayIso();
  let fired = 0;

  for (const rule of rules) {
    const config: AlertRuleConfig = JSON.parse(rule.config);

    if (rule.ruleType === "score_threshold") {
      const minScore = config.min_score || 15;
      const minUsers = config.min_users || 2;

      // Find companies meeting threshold with no recent alert for this rule
      const qualifying = db.select({
        companyId: companyScores.companyId,
        score: companyScores.score,
        userCount: companyScores.userCount,
      })
        .from(companyScores)
        .where(sql`
          ${companyScores.repoId} IS NULL
          AND ${companyScores.scope} = 'own'
          AND ${companyScores.date} = ${today}
          AND ${companyScores.score} >= ${minScore}
          AND ${companyScores.userCount} >= ${minUsers}
        `)
        .all();

      for (const q of qualifying) {
        // Check debounce (no alert for this rule+company in last 7 days)
        const recent = db.select().from(alertEvents)
          .where(sql`
            ${alertEvents.ruleId} = ${rule.id}
            AND ${alertEvents.companyId} = ${q.companyId}
            AND ${alertEvents.firedAt} >= datetime('now', '-7 days')
          `)
          .get();
        if (recent) continue;

        const company = db.select().from(companies).where(sql`${companies.id} = ${q.companyId}`).get();
        if (!company) continue;

        db.insert(alertEvents).values({
          ruleId: rule.id,
          companyId: q.companyId,
          title: `High engagement: ${company.name}`,
          detail: `Score: ${q.score.toFixed(0)}, Users: ${q.userCount}${company.domain ? `, Domain: ${company.domain}` : ""}`,
          metadata: JSON.stringify({ score: q.score, userCount: q.userCount }),
        }).run();
        fired++;
      }
    }

    if (rule.ruleType === "engagement_spike") {
      const pctIncrease = config.percent_increase || 100;
      const windowDays = config.window_days || 7;
      const compareDate = daysAgoIso(windowDays);

      const current = db.select({
        companyId: companyScores.companyId,
        score: companyScores.score,
      })
        .from(companyScores)
        .where(
          sql`${companyScores.repoId} IS NULL AND ${companyScores.scope} = 'own' AND ${companyScores.date} = ${today}`
        )
        .all();

      for (const c of current) {
        const prev = db.select({ score: companyScores.score })
          .from(companyScores)
          .where(sql`
            ${companyScores.companyId} = ${c.companyId}
            AND ${companyScores.repoId} IS NULL
            AND ${companyScores.scope} = 'own'
            AND ${companyScores.date} <= ${compareDate}
          `)
          .orderBy(sql`${companyScores.date} DESC`)
          .limit(1)
          .get();

        if (!prev || prev.score === 0) continue;
        const increase = ((c.score - prev.score) / prev.score) * 100;
        if (increase < pctIncrease) continue;

        // Debounce
        const recent = db.select().from(alertEvents)
          .where(sql`
            ${alertEvents.ruleId} = ${rule.id}
            AND ${alertEvents.companyId} = ${c.companyId}
            AND ${alertEvents.firedAt} >= datetime('now', '-7 days')
          `)
          .get();
        if (recent) continue;

        const company = db.select().from(companies).where(sql`${companies.id} = ${c.companyId}`).get();
        if (!company) continue;

        db.insert(alertEvents).values({
          ruleId: rule.id,
          companyId: c.companyId,
          title: `Engagement spike: ${company.name}`,
          detail: `Score increased ${increase.toFixed(0)}% in ${windowDays} days (${prev.score.toFixed(0)} → ${c.score.toFixed(0)})`,
          metadata: JSON.stringify({ increase, prevScore: prev.score, newScore: c.score }),
        }).run();
        fired++;
      }
    }

    if (rule.ruleType === "new_prospect") {
      const minScore = config.min_score || 20;

      // Competitor-only companies (no own aggregate today) over threshold —
      // the segment-prospect definition expressed directly on the aggregates.
      const prospects = db
        .select({ companyId: companyScores.companyId, score: companyScores.score })
        .from(companyScores)
        .where(sql`
          ${companyScores.repoId} IS NULL
          AND ${companyScores.scope} = 'competitor'
          AND ${companyScores.date} = ${today}
          AND ${companyScores.score} >= ${minScore}
          AND ${companyScores.companyId} NOT IN (
            SELECT company_id FROM company_scores
            WHERE repo_id IS NULL AND scope = 'own' AND date = ${today}
          )
        `)
        .all();

      for (const p of prospects) {
        const recent = db.select().from(alertEvents)
          .where(sql`
            ${alertEvents.ruleId} = ${rule.id}
            AND ${alertEvents.companyId} = ${p.companyId}
            AND ${alertEvents.firedAt} >= datetime('now', '-7 days')
          `)
          .get();
        if (recent) continue;

        const company = db.select().from(companies).where(sql`${companies.id} = ${p.companyId}`).get();
        if (!company) continue;
        const competitor = topCompetitorFor(db, p.companyId);

        db.insert(alertEvents).values({
          ruleId: rule.id,
          companyId: p.companyId,
          title: `New prospect: ${company.name}`,
          detail: `Competitor score ${p.score.toFixed(0)}${competitor ? ` engaging ${competitor}` : ""} — no engagement on our repos${company.domain ? ` (${company.domain})` : ""}`,
          metadata: JSON.stringify({ competitorScore: p.score, competitor }),
        }).run();
        fired++;
      }
    }

    if (rule.ruleType === "battleground_shift") {
      // Companies carrying BOTH aggregates today…
      const both = db
        .select({ companyId: companyScores.companyId })
        .from(companyScores)
        .where(sql`${companyScores.repoId} IS NULL AND ${companyScores.date} = ${today}`)
        .groupBy(companyScores.companyId)
        .having(sql`COUNT(DISTINCT ${companyScores.scope}) = 2`)
        .all();

      for (const b of both) {
        // …whose most recent prior state was NOT already battleground.
        const prior = db
          .select({ date: companyScores.date })
          .from(companyScores)
          .where(
            sql`${companyScores.companyId} = ${b.companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.date} < ${today}`
          )
          .orderBy(sql`${companyScores.date} DESC`)
          .limit(1)
          .get();
        if (!prior) continue; // brand-new both-sided company — new_prospect/score_threshold territory

        const priorScopes = new Set(
          db
            .select({ scope: companyScores.scope })
            .from(companyScores)
            .where(
              sql`${companyScores.companyId} = ${b.companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.date} = ${prior.date}`
            )
            .all()
            .map((r) => r.scope)
        );
        if (priorScopes.has("own") && priorScopes.has("competitor")) continue; // steady state

        const recent = db.select().from(alertEvents)
          .where(sql`
            ${alertEvents.ruleId} = ${rule.id}
            AND ${alertEvents.companyId} = ${b.companyId}
            AND ${alertEvents.firedAt} >= datetime('now', '-7 days')
          `)
          .get();
        if (recent) continue;

        const company = db.select().from(companies).where(sql`${companies.id} = ${b.companyId}`).get();
        if (!company) continue;
        const competitor = topCompetitorFor(db, b.companyId);
        const priorSegment = priorScopes.has("own") ? "engaged" : "prospect";
        const direction =
          priorSegment === "engaged"
            ? `started engaging competitor repos${competitor ? ` (${competitor})` : ""}`
            : "started engaging our repos";

        db.insert(alertEvents).values({
          ruleId: rule.id,
          companyId: b.companyId,
          title: `Battleground: ${company.name}`,
          detail: `${company.name} ${direction} — now evaluating both sides`,
          metadata: JSON.stringify({ priorSegment, competitor }),
        }).run();
        fired++;
      }
    }

    if (rule.ruleType === "competitor_employee_engagement") {
      const windowDays = config.window_days || 7;

      // Tagged employees with freshly-collected events on OUR repos only —
      // collected_at (not event_date) so historic backfills never fire.
      const rows = db
        .select({
          userId: githubUsers.id,
          login: githubUsers.login,
          competitor: githubUsers.competitorEmployee,
          owner: trackedRepos.owner,
          repoName: trackedRepos.name,
          eventType: githubEngagementEvents.eventType,
        })
        .from(githubEngagementEvents)
        .innerJoin(githubUsers, sql`${githubEngagementEvents.userId} = ${githubUsers.id}`)
        .innerJoin(trackedRepos, sql`${githubEngagementEvents.repoId} = ${trackedRepos.id}`)
        .where(sql`
          ${githubUsers.competitorEmployee} IS NOT NULL
          AND ${trackedRepos.competitor} IS NULL
          AND ${githubEngagementEvents.collectedAt} >= datetime('now', '-' || ${windowDays} || ' days')
        `)
        .all();

      const byUser = new Map<number, typeof rows>();
      for (const row of rows) {
        if (!byUser.has(row.userId)) byUser.set(row.userId, []);
        byUser.get(row.userId)!.push(row);
      }

      for (const [userId, userRows] of byUser) {
        const recent = db.select().from(alertEvents)
          .where(sql`
            ${alertEvents.ruleId} = ${rule.id}
            AND ${alertEvents.userId} = ${userId}
            AND ${alertEvents.firedAt} >= datetime('now', '-7 days')
          `)
          .get();
        if (recent) continue;

        const first = userRows[0];
        const types = [...new Set(userRows.map((r) => r.eventType))].join(", ");
        db.insert(alertEvents).values({
          ruleId: rule.id,
          userId,
          title: `Competitor employee engaging our repos: ${first.login}`,
          detail: `${first.login} (${first.competitor}) — ${types} on ${first.owner}/${first.repoName}`,
          metadata: JSON.stringify({ competitor: first.competitor, eventTypes: types }),
        }).run();
        fired++;
      }
    }

    if (rule.ruleType === "new_enterprise_user") {
      const domains = config.domains || [];
      if (domains.length === 0) continue;

      for (const domain of domains) {
        const recentEmails = db.select().from(githubUserEmails)
          .where(sql`${githubUserEmails.domain} = ${domain}`)
          .all();

        for (const e of recentEmails) {
          const recent = db.select().from(alertEvents)
            .where(sql`
              ${alertEvents.ruleId} = ${rule.id}
              AND ${alertEvents.userId} = ${e.userId}
              AND ${alertEvents.firedAt} >= datetime('now', '-30 days')
            `)
            .get();
          if (recent) continue;

          db.insert(alertEvents).values({
            ruleId: rule.id,
            userId: e.userId,
            title: `Enterprise user from ${domain}`,
            detail: `Developer with ${domain} email engaged with tracked repos`,
            metadata: JSON.stringify({ email: e.email, domain }),
          }).run();
          fired++;
        }
      }
    }
  }

  console.log(`[alerts] Evaluated ${rules.length} rules, fired ${fired} alerts`);
}
