"use client";

import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { useMetricPage, type MetricPageConfig } from "@/components/metric-page/use-metric-page";
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

export default function PypiPage() {
  const page = useMetricPage<PypiPackageSummary, PypiDetail>(CONFIG);

  const aggregated = aggregateByDate(page.detail?.downloads ?? []);
  const totalInPeriod = aggregated.reduce((s, d) => s + d.downloads, 0);

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
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Downloads - {page.current?.displayName || page.current?.name}
          </h3>
          <TimeSeriesChart
            data={aggregated}
            metrics={[
              {
                key: "downloads",
                label: "Downloads",
                color: "var(--chart-2)",
                type: "area",
              },
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
