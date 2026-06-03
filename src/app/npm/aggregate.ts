import { toIsoDate } from "@/lib/dates";
import type { DownloadRow } from "@/lib/types/api";

/** npm-specific weekly rollup (weeks keyed by their Sunday). Page-specific by
 *  design — declared as a transform instead of buried in the page body. */
export function aggregateWeekly(data: DownloadRow[]): Record<string, string | number>[] {
  const weeks: Record<string, number> = {};
  for (const d of data) {
    const date = new Date(d.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = toIsoDate(weekStart);
    weeks[key] = (weeks[key] || 0) + d.downloads;
  }
  return Object.entries(weeks).map(([date, downloads]) => ({ date, downloads }));
}

/** npm-specific monthly rollup (keyed by the 1st of the month). */
export function aggregateMonthly(data: DownloadRow[]): Record<string, string | number>[] {
  const months: Record<string, number> = {};
  for (const d of data) {
    const key = d.date.slice(0, 7) + "-01";
    months[key] = (months[key] || 0) + d.downloads;
  }
  return Object.entries(months).map(([date, downloads]) => ({ date, downloads }));
}
