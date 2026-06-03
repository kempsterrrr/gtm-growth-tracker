"use client";

import { useState } from "react";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useMetricPage, type MetricPageConfig } from "@/components/metric-page/use-metric-page";
import {
  useCompetitorCompare,
  type CompetitorCompareConfig,
} from "@/components/metric-page/use-competitor-compare";
import { mergeCompareRows, type CompareRow } from "@/components/metric-page/compare";
import { MetricPageShell, EmptyNotice } from "@/components/metric-page/MetricPageShell";
import { aggregateWeekly, aggregateMonthly } from "./aggregate";
import type { NpmPackageSummary, DownloadRow, TrackedEvent } from "@/lib/types/api";

interface NpmDetail {
  downloads: DownloadRow[];
  events: TrackedEvent[];
}

const CONFIG: MetricPageConfig<NpmDetail> = {
  listUrl: "/api/metrics/npm",
  detailUrls: (id, qs) => [`/api/metrics/npm?${qs({ packageId: id })}`, `/api/events?${qs()}`],
  combineDetail: ([downloads, events]) => ({
    downloads: downloads as DownloadRow[],
    events: events as TrackedEvent[],
  }),
};

const COMPARE_CONFIG: CompetitorCompareConfig = {
  listUrl: "/api/metrics/npm?competitors=1",
  seriesUrl: (id, qs) => `/api/metrics/npm?${qs({ packageId: String(id) })}`,
  toRows: (raw) => (raw as DownloadRow[]).map((d) => ({ date: d.date, value: d.downloads })),
};

export default function NpmPage() {
  const page = useMetricPage<NpmPackageSummary, NpmDetail>(CONFIG);
  const [aggregation, setAggregation] = useState("daily");
  const compare = useCompetitorCompare(COMPARE_CONFIG, page.dateRange, page.buildQueryString);

  const chartData = page.detail?.downloads ?? [];
  const displayData =
    aggregation === "weekly"
      ? aggregateWeekly(chartData)
      : aggregation === "monthly"
        ? aggregateMonthly(chartData)
        : chartData.map((d) => ({ date: d.date, downloads: d.downloads }));
  const totalDownloads = chartData.reduce((s, d) => s + d.downloads, 0);

  // Competitor rows follow the same aggregation as our own series.
  const aggregateCompare = (rows: CompareRow[]): CompareRow[] => {
    if (aggregation === "daily") return rows;
    const asDownloads = rows.map((r) => ({ date: r.date, downloads: r.value }));
    const agg =
      aggregation === "weekly" ? aggregateWeekly(asDownloads) : aggregateMonthly(asDownloads);
    return agg.map((r) => ({ date: String(r.date), value: Number(r.downloads) }));
  };
  const compareSeries = compare.series.map((s) => ({ ...s, rows: aggregateCompare(s.rows) }));
  const mergedData = mergeCompareRows(displayData, compareSeries);

  return (
    <MetricPageShell
      title="npm Downloads"
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
      emptyMessage="No npm packages tracked. Add packages in Settings."
      cardColumns={4}
      cards={
        page.current
          ? [
              {
                title: "Weekly Downloads",
                value: page.current.downloadsLast7d,
                delta: page.current.growthPercent7d,
                description: "vs previous week",
              },
              { title: "Total in Period", value: totalDownloads },
            ]
          : []
      }
    >
      {displayData.length > 0 ? (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Downloads - {page.current?.displayName || page.current?.name}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={compare.enabled ? "default" : "outline"}
                onClick={() => compare.setEnabled(!compare.enabled)}
              >
                Compare
              </Button>
              <Tabs defaultValue="daily">
                <TabsList>
                  <TabsTrigger value="daily" onClick={() => setAggregation("daily")}>
                    Daily
                  </TabsTrigger>
                  <TabsTrigger value="weekly" onClick={() => setAggregation("weekly")}>
                    Weekly
                  </TabsTrigger>
                  <TabsTrigger value="monthly" onClick={() => setAggregation("monthly")}>
                    Monthly
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
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
                color: "var(--chart-1)",
                type: aggregation === "daily" ? "area" : "bar",
              },
              ...compareSeries.map((s) => ({
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
        <EmptyNotice message="No download data available. Run the data collector first." />
      )}
    </MetricPageShell>
  );
}
