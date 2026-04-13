import { getDb } from "../db/client";
import { githubEngagementEvents, githubUsers, githubUserEmails } from "../db/schema";
import { extractDomain, isFreemailDomain } from "../utils/domain";
import { sql } from "drizzle-orm";

export async function collectCommitEmails() {
  const db = getDb();

  // Get all commit events that have metadata with email
  const commitEvents = db.select({
    userId: githubEngagementEvents.userId,
    metadata: githubEngagementEvents.metadata,
  })
    .from(githubEngagementEvents)
    .where(sql`${githubEngagementEvents.eventType} = 'commit' AND ${githubEngagementEvents.metadata} IS NOT NULL`)
    .all();

  let extracted = 0;
  const seen = new Set<string>();

  for (const event of commitEvents) {
    if (!event.metadata) continue;

    let email: string;
    try {
      const meta = JSON.parse(event.metadata);
      email = meta.email;
    } catch {
      continue;
    }

    if (!email) continue;

    const key = `${event.userId}:${email}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const domain = extractDomain(email);
    if (!domain || isFreemailDomain(domain)) continue;

    db.insert(githubUserEmails)
      .values({ userId: event.userId, email, domain, source: "commit" })
      .onConflictDoNothing()
      .run();
    extracted++;
  }

  console.log(`[commit-emails] Extracted ${extracted} work emails from commits`);
}
