import { getDb } from "./client";
import { alertRules } from "./schema";

/** Idempotently seeds default data (formerly embedded in the hand-written
 *  migration). Runs as the `seed-defaults` pipeline step — migrations stay
 *  pure DDL. */
export function seedDefaults() {
  const db = getDb();
  db.insert(alertRules)
    .values([
      {
        id: 1,
        name: "High-engagement company",
        description: "Fires when a company reaches meaningful engagement from multiple people",
        ruleType: "score_threshold",
        config: '{"min_score":15,"min_users":2}',
        enabled: 1,
        notifySlack: 1,
      },
      {
        id: 2,
        name: "Engagement spike",
        description: "Fires when a company's score doubles in a week",
        ruleType: "engagement_spike",
        config: '{"percent_increase":100,"window_days":7}',
        enabled: 1,
        notifySlack: 1,
      },
    ])
    .onConflictDoNothing()
    .run();
  console.log("[seed-defaults] Default alert rules ensured");
}
