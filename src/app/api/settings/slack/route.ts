import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { slackConfig } from "@/lib/db/schema";
import { sendSlackWebhook } from "@/lib/api-clients/slack-client";
import { sql } from "drizzle-orm";

export async function GET() {
  const db = getDb();
  const config = db.select().from(slackConfig).where(sql`${slackConfig.id} = 1`).get();

  return NextResponse.json({
    configured: !!config?.webhookUrl,
    channelName: config?.channelName || "",
    enabled: !!config?.enabled,
    // Don't expose the full webhook URL for security
    webhookUrlSet: !!config?.webhookUrl,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  // Test endpoint
  if (body.test && body.webhookUrl) {
    const success = await sendSlackWebhook(body.webhookUrl, {
      text: "ar.io Growth Tracker: Test notification working!",
    });
    return NextResponse.json({ success });
  }

  // Save config
  db.insert(slackConfig)
    .values({
      id: 1,
      webhookUrl: body.webhookUrl,
      channelName: body.channelName || null,
      enabled: body.enabled ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [slackConfig.id],
      set: {
        webhookUrl: sql`excluded.webhook_url`,
        channelName: sql`excluded.channel_name`,
        enabled: sql`excluded.enabled`,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();

  return NextResponse.json({ success: true });
}
