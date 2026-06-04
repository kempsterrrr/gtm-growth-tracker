import type { CompanySummary, CompanySegment } from "@/lib/types/api";

/** Companies-page derivations — exported and unit-tested per convention. */

export type SegmentFilter = CompanySegment | "all";

export function filterCompanies(
  companies: CompanySummary[],
  segment: SegmentFilter
): CompanySummary[] {
  if (segment === "all") return companies;
  return companies.filter((c) => c.segment === segment);
}

export type SortKey = "score" | "competitorScore" | "lastActive";
export interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}

export function sortCompanies(
  companies: CompanySummary[],
  sort: SortSpec | null
): CompanySummary[] {
  if (!sort) return companies;
  const sign = sort.dir === "desc" ? -1 : 1;
  if (sort.key === "lastActive") {
    // ISO dates compare lexically; companies with no timestamp sort last in
    // both directions (they're the least actionable).
    return [...companies].sort((a, b) => {
      const av = latestActivity(a);
      const bv = latestActivity(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sign * av.localeCompare(bv);
    });
  }
  const key = sort.key; // narrowed to the numeric keys; const propagates into the closure
  return [...companies].sort((a, b) => sign * (a[key] - b[key]));
}

/** The fresher of the two per-side timestamps (PRD #34), null when neither
 *  side has live engagement (deps-only prospects). */
export function latestActivity(company: CompanySummary): string | null {
  const { lastOwnEngagementAt: own, lastCompetitorEngagementAt: comp } = company;
  if (own && comp) return own > comp ? own : comp;
  return own ?? comp ?? null;
}

export type ActivityWindow = "all" | "90d" | "30d";

export function filterByActivity(
  companies: CompanySummary[],
  window: ActivityWindow,
  todayIsoDate: string
): CompanySummary[] {
  if (window === "all") return companies;
  const days = window === "90d" ? 90 : 30;
  const cutoff = new Date(new Date(todayIsoDate).getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  return companies.filter((c) => {
    const latest = latestActivity(c);
    return latest !== null && latest >= cutoff;
  });
}

/** "today" / "5d ago" / "3mo ago" / "2y ago" — the Last Active phrasing. */
export function formatRelativeAge(isoDate: string, todayIsoDate: string): string {
  const days = Math.max(
    0,
    Math.round((new Date(todayIsoDate).getTime() - new Date(isoDate).getTime()) / 86400000)
  );
  if (days === 0) return "today";
  if (days < 60) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** "4 issues, 2 forks" — demand-significance order (issues, forks, stars,
 *  PRs, commits), zeros skipped. The outreach line on the detail page. */
export function formatEngagementBreakdown(counts: {
  issueCount: number;
  forkCount: number;
  starCount: number;
  prCount: number;
  commitCount: number;
}): string {
  const parts: string[] = [];
  const add = (n: number, singular: string, plural = `${singular}s`) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  add(counts.issueCount, "issue");
  add(counts.forkCount, "fork");
  add(counts.starCount, "star");
  add(counts.prCount, "PR");
  add(counts.commitCount, "commit");
  return parts.length > 0 ? parts.join(", ") : "no engagement recorded";
}

/** "2 dependent repos" — the depends-on attribution phrasing. */
export function formatDependentCount(n: number): string {
  return `${n} dependent ${n === 1 ? "repo" : "repos"}`;
}
