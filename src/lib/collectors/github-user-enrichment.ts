import { getDb } from "../db/client";
import { githubUsers, githubUserEmails, githubUserOrgs, enrichmentQueue } from "../db/schema";
import { getUserProfile, getUserOrgs, getRateLimit } from "../api-clients/github-users-client";
import { extractDomain, isFreemailDomain } from "../utils/domain";
import { sql } from "drizzle-orm";

export async function collectUserEnrichment(batchSize = 50) {
  const db = getDb();

  const rateLimit = await getRateLimit();
  const needed = batchSize * 3;
  if (rateLimit.remaining < needed) {
    const adjusted = Math.floor(rateLimit.remaining / 3);
    if (adjusted < 5) {
      console.log(`[enrichment] Rate limit too low (${rateLimit.remaining}), skipping`);
      return;
    }
    batchSize = adjusted;
    console.log(`[enrichment] Reduced batch to ${batchSize} due to rate limit`);
  }

  const pending = db.select().from(enrichmentQueue)
    .where(sql`${enrichmentQueue.status} = 'pending'`)
    .orderBy(sql`${enrichmentQueue.priority} DESC, ${enrichmentQueue.createdAt} ASC`)
    .limit(batchSize)
    .all();

  if (pending.length === 0) {
    console.log("[enrichment] No users to enrich");
    return;
  }

  console.log(`[enrichment] Enriching ${pending.length} users...`);
  let enriched = 0;

  for (const item of pending) {
    try {
      // Mark processing
      db.update(enrichmentQueue)
        .set({ status: "processing", lastAttemptAt: new Date().toISOString() })
        .where(sql`${enrichmentQueue.id} = ${item.id}`)
        .run();

      // Fetch profile
      const profile = await getUserProfile(item.userLogin);

      db.update(githubUsers)
        .set({
          githubId: profile.id,
          name: profile.name,
          email: profile.email,
          companyRaw: profile.company,
          bio: profile.bio,
          blog: profile.blog,
          avatarUrl: profile.avatar_url,
          location: profile.location,
          twitterUsername: profile.twitter_username,
          enrichedAt: new Date().toISOString(),
        })
        .where(sql`${githubUsers.login} = ${item.userLogin}`)
        .run();

      // Store public email
      if (profile.email) {
        const domain = extractDomain(profile.email);
        if (domain && !isFreemailDomain(domain)) {
          const user = db.select().from(githubUsers).where(sql`${githubUsers.login} = ${item.userLogin}`).get();
          if (user) {
            db.insert(githubUserEmails)
              .values({ userId: user.id, email: profile.email, domain, source: "profile" })
              .onConflictDoNothing()
              .run();
          }
        }
      }

      // Fetch orgs
      try {
        const orgs = await getUserOrgs(item.userLogin);
        const user = db.select().from(githubUsers).where(sql`${githubUsers.login} = ${item.userLogin}`).get();
        if (user) {
          for (const org of orgs) {
            db.insert(githubUserOrgs)
              .values({
                userId: user.id,
                orgLogin: org.login,
                orgName: org.name,
                orgDescription: org.description,
                orgWebsite: org.blog || null,
              })
              .onConflictDoNothing()
              .run();
          }
        }
      } catch {
        // Orgs may fail for some users, continue
      }

      // Mark done
      db.update(enrichmentQueue)
        .set({ status: "done" })
        .where(sql`${enrichmentQueue.id} = ${item.id}`)
        .run();
      enriched++;
    } catch (err) {
      const attempts = item.attempts + 1;
      db.update(enrichmentQueue)
        .set({
          status: attempts >= 3 ? "failed" : "pending",
          attempts,
          lastAttemptAt: new Date().toISOString(),
        })
        .where(sql`${enrichmentQueue.id} = ${item.id}`)
        .run();
      console.warn(`[enrichment] Failed to enrich ${item.userLogin}:`, err);
    }
  }

  console.log(`[enrichment] Enriched ${enriched}/${pending.length} users`);
}
