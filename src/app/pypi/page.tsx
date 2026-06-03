"use client";

import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Button } from "@/components/ui/button";
import { useMetricPage, type MetricPageConfig } from "@/components/metric-page/use-metric-page";
import {
  useCompetitorCompare,
  type CompetitorCompareConfig,
} from "@/components/metric-page/use-competitor-compare";
import { mergeCompareRows } from "@/components/metric-page/compare";
import { MetricPageShell, EmptyNotice } from "@/components/metric-page/MetricPageShell";
import { aggregateByDate } from "./aggregate";
import type { PypiPackageSummary, PypiDownloadRow, TrackedEvent } from "@/lib/types/api";

interface PypiDetail {
  downloads: PypiDownloadRow[];
  events: TrackedEvent[];
}

const CONFIG: MetricPageConfig<PypiDetail> = {
  listUrl: "/api/metrics/pypi",
  detailUrls: (id, qs) => [`/api/metrics/pypi?${qs({ packageId: id })}`, `/api/events?${qs()}`],
  combineDetail: ([downloads, events]) => ({
    downloads: downloads as PypiDownloadRow[],
    events: events as TrackedEvent[],
  }),
};

const COMPARE_CONFIG: CompetitorCompareConfig = {
  listUrl: "/api/metrics/pypi?competitors=1",
  seriesUrl: (id, qs) => `/api/metrics/pypi?${qs({ packageId: String(id) })}`,
  // Sum across categoryValue mirrors exactly like the own series does.
  toRows: (raw) =>
    aggregateByDate(raw as PypiDownloadRow[]).map((d) => ({ date: d.date, value: d.downloads })),
};

export default function PypiPage() {
  const page = useMetricPage<PypiPackageSummary, PypiDetail>(CONFIG);
  const compare = useCompetitorCompare(COMPARE_CONFIG, page.dateRange, page.buildQueryString);

  const aggregated = aggregateByDate(page.detail?.downloads ?? []);
  const totalInPeriod = aggregated.reduce((s, d) => s + d.downloads, 0);
  const mergedData = mergeCompareRows(aggregated, compare.series);

  return (
    <MetricPageShell
      title="PyPI Downloads"
      dateRange={page.dateRange}
      onDateRangeChange={page.setDateRange}
      persona={page.persona}
      onPersonaChange={(p) => page.setPersona(p as typeof page.persona)}
      entities={page.entities}
      selected={page.selected}
      onSelect={page.setSelected}
      entityLabel={(p) => p.displayName || p.name}
      status={page.status}
      error={page.error}
      onRetry={page.retry}
      emptyMessage="No PyPI packages tracked. Add packages in Settings."
      cardColumns={3}
      cards={
        page.current
          ? [
              { title: "Weekly Downloads", value: page.current.downloadsLast7d },
              { title: "Total in Period", value: totalInPeriod },
            ]
          : []
      }
    >
      {aggregated.length > 0 ? (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Downloads - {page.current?.displayName || page.current?.name}
            </h3>
            <Button
              size="sm"
              variant={compare.enabled ? "default" : "outline"}
              onClick={() => compare.setEnabled(!compare.enabled)}
            >
              Compare
            </Button>
          </div>
          {compare.error && (
            <p className="text-sm text-destructive mb-2">Compare failed: {compare.error}</p>
          )}
          {compare.enabled && !compare.loading && !compare.error && compare.series.length === 0 && (
            <p className="text-sm text-muted-foreground mb-2">
              No competitor packages tracked. Add one in Settings with a competitor name.
            </p>
          )}
          <TimeSeriesChart
            data={mergedData}
            metrics={[
              {
                key: "downloads",
                label: "Downloads",
                color: "var(--chart-2)",
                type: "area",
              },
              ...compare.series.map((s) => ({
                key: s.key,
                label: s.label,
                color: s.color,
                type: "line" as const,
              })),
            ]}
            events={page.detail?.events}
            height={400}
          />
        </div>
      ) : (
        <EmptyNotice message="No PyPI data available. Run the data collector first." />
      )}
    </MetricPageShell>
  );
}
