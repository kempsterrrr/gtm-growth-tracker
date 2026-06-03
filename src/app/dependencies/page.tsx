"use client";

import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { useMetricPage, type MetricPageConfig } from "@/components/metric-page/use-metric-page";
import { MetricPageShell, EmptyNotice } from "@/components/metric-page/MetricPageShell";
import { DependentsTable } from "./DependentsTable";
import { GitFork } from "lucide-react";
import type { DependencySummary, DependencyDetailResponse } from "@/lib/types/api";

const CONFIG: MetricPageConfig<DependencyDetailResponse> = {
  listUrl: "/api/metrics/dependencies",
  detailUrls: (id, qs) => [`/api/metrics/dependencies?${qs({ packageId: id })}`],
  combineDetail: ([detail]) => detail as DependencyDetailResponse,
};

export default function DependenciesPage() {
  const page = useMetricPage<DependencySummary, DependencyDetailResponse>(CONFIG);

  const counts = page.detail?.counts ?? [];
  const dependents = page.detail?.dependents ?? [];

  // New dependents in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentDeps = dependents.filter((d) => new Date(d.firstSeen) >= thirtyDaysAgo);

  return (
    <MetricPageShell
      title="Dependencies"
      dateRange={page.dateRange}
      onDateRangeChange={page.setDateRange}
      persona={page.persona}
      onPersonaChange={(p) => page.setPersona(p as typeof page.persona)}
      entities={page.entities}
      selected={page.selected}
      onSelect={page.setSelected}
      entityLabel={(p) => p.displayName || `${p.registry}/${p.name}`}
      status={page.status}
      error={page.error}
      onRetry={page.retry}
      emptyMessage="No packages tracked. Add packages in Settings."
      cardColumns={3}
      cards={
        page.current
          ? [
              {
                title: "Total Dependents",
                value: page.current.dependentCount,
                icon: <GitFork className="h-4 w-4" />,
              },
              { title: "New This Month", value: recentDeps.length },
            ]
          : []
      }
    >
      {counts.length > 0 && (
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Dependent Count Over Time
          </h3>
          <TimeSeriesChart
            data={counts.map((c) => ({ date: c.date, count: c.count }))}
            metrics={[
              { key: "count", label: "Dependents", color: "var(--chart-2)", type: "area" },
            ]}
            height={300}
          />
        </div>
      )}

      {dependents.length > 0 && (
        <DependentsTable dependents={dependents} thirtyDaysAgo={thirtyDaysAgo} />
      )}

      {counts.length === 0 && dependents.length === 0 && (
        <EmptyNotice message="No dependency data available. Run the data collector first." />
      )}
    </MetricPageShell>
  );
}
