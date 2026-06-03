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

export type SortKey = "score" | "competitorScore";
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
  return [...companies].sort((a, b) => sign * (a[sort.key] - b[sort.key]));
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
