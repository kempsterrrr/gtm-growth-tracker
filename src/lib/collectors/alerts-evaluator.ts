import { getDb } from "../db/client";
import { alertRules, alertEvents, companyScores, companies, githubUserEmails } from "../db/schema";
import { sql } from "drizzle-orm";
import type { AlertRuleConfig } from "../types/sales-intelligence";

export async function evaluateAlerts() {
  const db = getDb();
  const rules = db.select().from(alertRules).where(sql`${alertRules.enabled} = 1`).all();

  if (rules.length === 0) return;

  const today = new Date().toISOString().split("T")[0];
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
      const compareDate = new Date(Date.now() - windowDays * 86400000).toISOString().split("T")[0];

      const current = db.select({
        companyId: companyScores.companyId,
        score: companyScores.score,
      })
        .from(companyScores)
        .where(sql`${companyScores.repoId} IS NULL AND ${companyScores.date} = ${today}`)
        .all();

      for (const c of current) {
        const prev = db.select({ score: companyScores.score })
          .from(companyScores)
          .where(sql`
            ${companyScores.companyId} = ${c.companyId}
            AND ${companyScores.repoId} IS NULL
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
