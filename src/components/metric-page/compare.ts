import type { CompetitorEntitySummary } from "@/lib/types/api";

/** Pure overlay math for the competitor compare toggle — exported and
 *  unit-tested per the metric-page conventions. The hook
 *  (use-competitor-compare.ts) owns fetching; pages own page-specific
 *  aggregation (npm weekly/monthly reuses its own tested transforms). */

export interface CompareRow {
  date: string;
  value: number;
}

export interface CompareSeries {
  /** Chart dataKey — stable per entity. */
  key: string;
  /** Legend label, competitor-first. */
  label: string;
  color: string;
  rows: CompareRow[];
}

export function competitorSeriesKey(id: number): string {
  return `competitor_${id}`;
}

export function competitorLabel(e: CompetitorEntitySummary): string {
  return `${e.competitor} — ${e.displayName || e.name}`;
}

/** Own series hold chart-1/2; overlays cycle the rest (4 is the lightest —
 *  last in the cycle). */
const OVERLAY_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)"];
export function competitorColor(index: number): string {
  return OVERLAY_COLORS[index % OVERLAY_COLORS.length];
}

/** Merge competitor series onto the page's own chart rows: one row per date
 *  carrying the own keys plus one key per competitor series. Dates missing on
 *  either side stay absent from that row (recharts skips them); the result is
 *  date-ascending. */
export function mergeCompareRows(
  own: Array<Record<string, string | number>>,
  series: CompareSeries[]
): Array<Record<string, string | number>> {
  if (series.length === 0) return own;
  const byDate = new Map<string, Record<string, string | number>>();
  for (const row of own) byDate.set(String(row.date), { ...row });
  for (const s of series) {
    for (const { date, value } of s.rows) {
      const row = byDate.get(date) ?? { date };
      row[s.key] = value;
      byDate.set(date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
