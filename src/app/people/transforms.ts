import type { PersonSummary } from "@/lib/types/api";
import type { ActivityWindow } from "../companies/transforms";

/** People-page derivations (PRD #42) — exported and unit-tested per
 *  convention; phrasing helpers are shared with the companies transforms. */

export function filterPeopleByEntity(
  people: PersonSummary[],
  entity: string | null
): PersonSummary[] {
  if (!entity) return people;
  return people.filter((p) => p.engagements.some((e) => e.entity === entity));
}

export function filterPeopleByActivity(
  people: PersonSummary[],
  window: ActivityWindow,
  todayIsoDate: string
): PersonSummary[] {
  if (window === "all") return people;
  const days = window === "90d" ? 90 : 30;
  const cutoff = new Date(new Date(todayIsoDate).getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  return people.filter((p) => p.lastActive !== null && p.lastActive >= cutoff);
}

export type PersonSortKey = "login" | "company" | "lastActive";
export interface PersonSortSpec {
  key: PersonSortKey;
  dir: "asc" | "desc";
}

export function sortPeople(
  people: PersonSummary[],
  sort: PersonSortSpec | null
): PersonSummary[] {
  if (!sort) return people;
  const sign = sort.dir === "desc" ? -1 : 1;
  if (sort.key === "login") {
    return [...people].sort(
      (a, b) => sign * a.login.localeCompare(b.login, undefined, { sensitivity: "base" })
    );
  }
  // Nullable string keys: missing values sort last in both directions.
  const value = (p: PersonSummary) =>
    sort.key === "company" ? (p.primaryCompany?.name ?? null) : p.lastActive;
  return [...people].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * av.localeCompare(bv, undefined, { sensitivity: "base" });
  });
}
