"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "./use-metric-page";
import {
  competitorSeriesKey,
  competitorLabel,
  competitorColor,
  type CompareRow,
  type CompareSeries,
} from "./compare";
import type { CompetitorEntitySummary } from "@/lib/types/api";

export interface CompetitorCompareConfig {
  /** The ?competitors=1 list view for this page's registry. */
  listUrl: string;
  /** Per-entity series URL (the unguarded detail-by-id path). */
  seriesUrl: (id: number, qs: (extra?: Record<string, string>) => string) => string;
  /** Map the raw series response to {date,value} rows. */
  toRows: (raw: unknown) => CompareRow[];
}

/**
 * The compare-toggle data flow, mirroring use-metric-page conventions: keyed
 * state (toggle + date range), derived loading, explicit error, no silent
 * catches. Configs must be module-level constants. Receives dateRange +
 * buildQueryString from the page's single useMetricPage call —
 * useDashboardFilters is per-call local state and must not be re-invoked.
 */
export function useCompetitorCompare(
  config: CompetitorCompareConfig,
  dateRange: string,
  buildQueryString: (extra?: Record<string, string>) => string
) {
  const [enabled, setEnabled] = useState(false);
  const [data, setData] = useState<{ key: string; series: CompareSeries[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const key = dateRange;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const entities = await fetchJson<CompetitorEntitySummary[]>(config.listUrl);
        const series = await Promise.all(
          entities.map(
            async (e, i): Promise<CompareSeries> => ({
              key: competitorSeriesKey(e.id),
              label: competitorLabel(e),
              color: competitorColor(i),
              rows: config.toRows(
                await fetchJson<unknown>(config.seriesUrl(e.id, buildQueryString))
              ),
            })
          )
        );
        if (!cancelled) setData({ key, series });
      } catch (err: unknown) {
        if (!cancelled) {
          setError({ key, message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, key, buildQueryString, config]);

  const series = enabled && data?.key === key ? data.series : [];
  const activeError = enabled && error?.key === key ? error.message : null;
  const loading = enabled && !activeError && data?.key !== key;

  return { enabled, setEnabled, series, loading, error: activeError };
}
