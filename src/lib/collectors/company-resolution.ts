import { getDb } from "../db/client";
import { githubUsers, githubUserEmails, githubUserOrgs, companies, githubUserCompanies } from "../db/schema";
import { normalizeCompanyName, domainToCompanyName, isFreemailDomain } from "../utils/domain";
import { tagCompetitorEmployees } from "./competitor-employees";
import { sql } from "drizzle-orm";

function getOrCreateCompanyByDomain(db: ReturnType<typeof getDb>, domain: string): number {
  const existing = db.select().from(companies).where(sql`${companies.domain} = ${domain}`).get();
  if (existing) return existing.id;

  const name = domainToCompanyName(domain);
  const result = db.insert(companies)
    .values({ name, domain, website: `https://${domain}` })
    .returning()
    .get();
  return result.id;
}

function getOrCreateCompanyByName(db: ReturnType<typeof getDb>, name: string): number {
  const normalized = normalizeCompanyName(name);
  if (!normalized) return -1;

  // Try exact match first
  const existing = db.select().from(companies)
    .where(sql`LOWER(${companies.name}) = LOWER(${normalized})`)
    .get();
  if (existing) return existing.id;

  const result = db.insert(companies)
    .values({ name: normalized })
    .returning()
    .get();
  return result.id;
}

function linkUserToCompany(
  db: ReturnType<typeof getDb>,
  userId: number, companyId: number,
  source: "email_domain" | "profile_company" | "org_membership",
  confidence: number
) {
  if (companyId < 0) return;
  db.insert(githubUserCompanies)
    .values({ userId, companyId, source, confidence })
    .onConflictDoUpdate({
      target: [githubUserCompanies.userId, githubUserCompanies.companyId],
      set: {
        // When stronger evidence arrives, lift the confidence AND the source
        // — the source is the "deciding signal" shown in the UI (PRD #42).
        // Both SET expressions see the pre-update row, so the comparison and
        // the MAX read the same old confidence.
        source: sql`CASE WHEN ${confidence} > ${githubUserCompanies.confidence} THEN ${source} ELSE ${githubUserCompanies.source} END`,
        confidence: sql`MAX(${githubUserCompanies.confidence}, ${confidence})`,
      },
    })
    .run();
}

/** Exactly one primary link per user: highest confidence wins, ties go to
 *  the first-discovered link. Set-wise and idempotent — links are never
 *  deleted, and a stronger signal arriving later upgrades the primary on the
 *  next run (PRD #42). */
function recomputePrimaryCompanies(db: ReturnType<typeof getDb>) {
  db.run(sql`UPDATE github_user_companies SET is_primary = 0 WHERE is_primary != 0`);
  db.run(sql`
    UPDATE github_user_companies SET is_primary = 1
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id ORDER BY confidence DESC, id ASC
        ) AS rn
        FROM github_user_companies
      ) WHERE rn = 1
    )
  `);
}

export async function resolveCompanies() {
  const db = getDb();
  let resolved = 0;

  // 1. Email domain resolution (highest confidence)
  const emails = db.select().from(githubUserEmails).all();
  const domainUsers = new Map<string, number[]>();
  for (const e of emails) {
    if (!domainUsers.has(e.domain)) domainUsers.set(e.domain, []);
    domainUsers.get(e.domain)!.push(e.userId);
  }

  for (const [domain, userIds] of domainUsers) {
    const companyId = getOrCreateCompanyByDomain(db, domain);
    for (const userId of new Set(userIds)) {
      linkUserToCompany(db, userId, companyId, "email_domain", 0.9);
      resolved++;
    }
  }
  console.log(`[company-resolution] Email domain: ${resolved} links`);

  // 2. Profile company field
  let profileLinks = 0;
  const usersWithCompany = db.select().from(githubUsers)
    .where(sql`${githubUsers.companyRaw} IS NOT NULL AND ${githubUsers.companyRaw} != ''`)
    .all();

  for (const user of usersWithCompany) {
    const raw = user.companyRaw!;
    // If it looks like @org, try matching to a domain
    if (raw.startsWith("@")) {
      const orgName = raw.slice(1).toLowerCase();
      // Check if it matches any company domain
      const byDomain = db.select().from(companies)
        .where(sql`LOWER(${companies.domain}) LIKE ${orgName + '%'}`)
        .get();
      if (byDomain) {
        linkUserToCompany(db, user.id, byDomain.id, "profile_company", 0.7);
        profileLinks++;
        continue;
      }
    }

    const companyId = getOrCreateCompanyByName(db, raw);
    if (companyId > 0) {
      linkUserToCompany(db, user.id, companyId, "profile_company", 0.7);
      profileLinks++;
    }
  }
  console.log(`[company-resolution] Profile field: ${profileLinks} links`);

  // 3. Org membership
  let orgLinks = 0;
  const orgs = db.select().from(githubUserOrgs).all();
  for (const org of orgs) {
    if (org.orgWebsite) {
      let domain: string;
      try {
        domain = new URL(org.orgWebsite.startsWith("http") ? org.orgWebsite : `https://${org.orgWebsite}`).hostname;
        domain = domain.replace(/^www\./, "");
      } catch (err) {
        console.warn(`[company-resolution] Skipping invalid org website "${org.orgWebsite}":`, err);
        continue;
      }
      if (isFreemailDomain(domain)) continue;
      const companyId = getOrCreateCompanyByDomain(db, domain);
      linkUserToCompany(db, org.userId, companyId, "org_membership", 0.6);
      orgLinks++;
    } else {
      // Create company from org name
      const companyId = getOrCreateCompanyByName(db, org.orgName || org.orgLogin);
      if (companyId > 0) {
        linkUserToCompany(db, org.userId, companyId, "org_membership", 0.6);
        orgLinks++;
      }
    }
  }
  console.log(`[company-resolution] Org membership: ${orgLinks} links`);
  console.log(`[company-resolution] Total: ${resolved + profileLinks + orgLinks} user-company links`);

  // One human, one employer: pick each user's primary link (PRD #42).
  recomputePrimaryCompanies(db);

  // Employee tagging happens "during/after company resolution" (PRD #17) —
  // it needs the freshly-resolved company links for the domain signal.
  await tagCompetitorEmployees();
}
