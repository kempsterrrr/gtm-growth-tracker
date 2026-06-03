/**
 * THE definition of date and growth semantics for the whole app — routes,
 * collectors, hooks, and pages all import from here so "last 7 days" and
 * "growth" mean exactly one thing. Pure functions only (client-safe); the
 * optional base-date parameters exist for deterministic tests.
 */

const DAY_MS = 86_400_000;

/** A Date as the app's canonical YYYY-MM-DD (UTC) string. */
export function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** Today as YYYY-MM-DD. */
export function todayIso(base: Date = new Date()): string {
  return toIsoDate(base);
}

/** N days before the base date as YYYY-MM-DD. */
export function daysAgoIso(days: number, base: Date = new Date()): string {
  return toIsoDate(new Date(base.getTime() - days * DAY_MS));
}

/** Percentage growth from previous to current; 0 when previous is 0
 *  (matches the dashboard's existing summary-card semantics). */
export function growthPercent(current: number, previous: number): number {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}
