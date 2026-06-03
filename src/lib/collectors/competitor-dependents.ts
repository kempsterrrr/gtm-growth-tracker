import { getDb } from "../db/client";
import {
  trackedPackages,
  reverseDependencies,
  companies,
  companyCompetitorSignals,
} from "../db/schema";
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
import { getPackageSourceRepo } from "../api-clients/deps-dev-client";
import { isFreemailDomain, normalizeCompanyName } from "../utils/domain";
import { sql, isNotNull } from "drizzle-orm";
import { todayIso } from "../dates";

type GetRepoFn = (registry: string, pkg: string, version: string | null) => Promise<string | null>;

/** Mirrors company-resolution's org path: website domain first, name second. */
function getOrCreateCompanyForOrg(
  db: ReturnType<typeof getDb>,
  orgLogin: string,
  profile: { name: string | null; blog: string | null }
): number | null {
  if (profile.blog) {
    try {
      const url = profile.blog.startsWith("http") ? profile.blog : `https://${profile.blog}`;
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (domain && !isFreemailDomain(domain)) {
        const existing = db
          .select()
          .from(companies)
          .where(sql`${companies.domain} = ${domain}`)
          .get();
        if (existing) return existing.id;
        return db
          .insert(companies)
          .values({ name: profile.name || orgLogin, domain, website: `https://${domain}` })
          .returning()
          .get().id;
      }
    } catch {
      // fall through to the name path
    }
  }
  const normalized = normalizeCompanyName(profile.name || orgLogin);
  if (!normalized) return null;
  const existing = db
    .select()
    .from(companies)
    .where(sql`LOWER(${companies.name}) = LOWER(${normalized})`)
    .get();
  if (existing) return existing.id;
  return db.insert(companies).values({ name: normalized }).returning().get().id;
}

/**
 * The depends-on-competitor signal (PRD #17, issue #22): dependents of
 * competitor packages → source repo (deps.dev) → owning org (GitHub) →
 * company, recorded one row per (company, package, dependent). Unresolvable
 * dependents are skipped per-dependent — data quality never fails the step.
 */
export async function resolveCompetitorDependents(
  getRepoFn: GetRepoFn = getPackageSourceRepo,
  client: GithubClient = createGithubClient()
) {
  const db = getDb();
  const today = todayIso();

  const competitorPackages = db
    .select()
    .from(trackedPackages)
    .where(isNotNull(trackedPackages.competitor))
    .all();
  if (competitorPackages.length === 0) {
    console.log("[competitor-deps] No competitor packages tracked");
    return;
  }

  const orgCompanyCache = new Map<string, number | null>();
  let recorded = 0;
  let skipped = 0;

  for (const pkg of competitorPackages) {
    const dependents = db
      .select()
      .from(reverseDependencies)
      .where(sql`${reverseDependencies.packageId} = ${pkg.id}`)
      .all();

    for (const dependent of dependents) {
      try {
        const repo = await getRepoFn(
          dependent.dependentRegistry,
          dependent.dependentName,
          dependent.dependentVersion
        );
        if (!repo) {
          skipped++;
          continue;
        }
        const owner = repo.split("/")[1]; // "github.com/{owner}/{name}"
        if (!owner) {
          skipped++;
          continue;
        }

        let companyId = orgCompanyCache.get(owner);
        if (companyId === undefined) {
          try {
            const profile = await client.getUserProfile(owner);
            companyId = getOrCreateCompanyForOrg(db, owner, profile);
          } catch {
            companyId = null; // org lookup failed — skip, never fail the step
          }
          orgCompanyCache.set(owner, companyId);
        }
        if (companyId == null) {
          skipped++;
          continue;
        }

        db.insert(companyCompetitorSignals)
          .values({
            companyId,
            packageId: pkg.id,
            signalType: "depends_on",
            dependentName: dependent.dependentName,
            firstSeen: today,
          })
          .onConflictDoNothing()
          .run();
        recorded++;
      } catch (err) {
        skipped++;
        console.warn(`[competitor-deps] Skipping ${dependent.dependentName}:`, err);
      }
    }
  }

  console.log(`[competitor-deps] ${recorded} signals recorded, ${skipped} dependents skipped`);
}
