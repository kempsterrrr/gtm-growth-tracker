import { getDb } from "../db/client";
import { alertEvents, slackConfig } from "../db/schema";
import { sendSlackWebhook } from "../api-clients/slack-client";
import { sql } from "drizzle-orm";

export async function sendAlertNotifications() {
  const db = getDb();

  // Get Slack config (from DB or env)
  const config = db.select().from(slackConfig).where(sql`${slackConfig.id} = 1`).get();
  const webhookUrl = config?.webhookUrl || process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl || (config && !config.enabled && !process.env.SLACK_WEBHOOK_URL)) {
    return;
  }

  // Get unsent alerts
  const pending = db.select().from(alertEvents)
    .where(sql`${alertEvents.slackSent} = 0`)
    .all();

  if (pending.length === 0) return;

  console.log(`[slack] Sending ${pending.length} alert notifications...`);

  for (const alert of pending) {
    const success = await sendSlackWebhook(webhookUrl, {
      text: alert.title,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: alert.title, emoji: true },
        },
        ...(alert.detail
          ? [{
              type: "section" as const,
              text: { type: "mrkdwn" as const, text: alert.detail },
            }]
          : []),
      ],
    });

    if (success) {
      db.update(alertEvents)
        .set({ slackSent: 1 })
        .where(sql`${alertEvents.id} = ${alert.id}`)
        .run();
    }
  }

  console.log(`[slack] Sent ${pending.length} notifications`);
}
