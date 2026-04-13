import { getDb } from "../db/client";
import { githubUsers, githubUserEmails, githubUserOrgs, companies, githubUserCompanies } from "../db/schema";
import { normalizeCompanyName, domainToCompanyName, extractDomain, isFreemailDomain } from "../utils/domain";
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
        confidence: sql`MAX(${githubUserCompanies.confidence}, ${confidence})`,
      },
    })
    .run();
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
      } catch {
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
}
