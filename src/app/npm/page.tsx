"use client";

import { useState } from "react";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMetricPage, type MetricPageConfig } from "@/components/metric-page/use-metric-page";
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

export default function NpmPage() {
  const page = useMetricPage<NpmPackageSummary, NpmDetail>(CONFIG);
  const [aggregation, setAggregation] = useState("daily");

  const chartData = page.detail?.downloads ?? [];
  const displayData =
    aggregation === "weekly"
      ? aggregateWeekly(chartData)
      : aggregation === "monthly"
        ? aggregateMonthly(chartData)
        : chartData.map((d) => ({ date: d.date, downloads: d.downloads }));
  const totalDownloads = chartData.reduce((s, d) => s + d.downloads, 0);

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
          <TimeSeriesChart
            data={displayData}
            metrics={[
              {
                key: "downloads",
                label: "Downloads",
                color: "var(--chart-1)",
                type: aggregation === "daily" ? "area" : "bar",
              },
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
