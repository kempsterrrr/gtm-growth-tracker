export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: { type: string; text: string }; url?: string }>;
}

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

export async function sendSlackWebhook(webhookUrl: string, message: SlackMessage): Promise<boolean> {
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    return resp.ok;
  } catch (err) {
    console.error("[slack] Webhook failed:", err);
    return false;
  }
}
