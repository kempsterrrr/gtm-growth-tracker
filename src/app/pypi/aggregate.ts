import type { PypiDownloadRow } from "@/lib/types/api";

/** Sum across categoryValues (with/without mirrors) per date, sorted. Moved
 *  verbatim from the page body. */
export function aggregateByDate(
  rows: PypiDownloadRow[]
): Array<{ date: string; downloads: number }> {
  return Object.values(
    rows.reduce<Record<string, { date: string; downloads: number }>>((acc, d) => {
      if (!acc[d.date]) acc[d.date] = { date: d.date, downloads: 0 };
      acc[d.date].downloads += d.downloads;
      return acc;
    }, {})
  ).sort((a, b) => a.date.localeCompare(b.date));
}
