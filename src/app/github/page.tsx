"use client";

import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { useMetricPage, type MetricPageConfig } from "@/components/metric-page/use-metric-page";
import { MetricPageShell, EmptyNotice } from "@/components/metric-page/MetricPageShell";
import { Star, GitFork, Eye, CircleDot, Users } from "lucide-react";
import type {
  GithubRepoSummary,
  GithubRepoMetricsResponse,
  GithubMetricRow,
  TrafficRow,
  TrackedEvent,
} from "@/lib/types/api";

interface GithubDetail {
  metrics: GithubMetricRow[];
  clones: TrafficRow[];
  views: TrafficRow[];
  events: TrackedEvent[];
}

const CONFIG: MetricPageConfig<GithubDetail> = {
  listUrl: "/api/metrics/github",
  detailUrls: (id, qs) => [
    `/api/metrics/github?${qs({ repoId: id, metric: "all" })}`,
    `/api/events?${qs({ repoId: id })}`,
  ],
  combineDetail: ([data, events]) => {
    const d = data as GithubRepoMetricsResponse;
    return {
      metrics: d.metrics ?? [],
      clones: d.clones ?? [],
      views: d.views ?? [],
      events: events as TrackedEvent[],
    };
  },
};

export default function GithubPage() {
  const page = useMetricPage<GithubRepoSummary, GithubDetail>(CONFIG);

  const showMarketing =
    page.persona === "all" || page.persona === "marketing" || page.persona === "gtm";
  const showEngineering =
    page.persona === "all" || page.persona === "engineering" || page.persona === "gtm";

  const metricsData = page.detail?.metrics ?? [];
  const clonesData = page.detail?.clones ?? [];
  const viewsData = page.detail?.views ?? [];

  return (
    <MetricPageShell
      title="GitHub Metrics"
      dateRange={page.dateRange}
      onDateRangeChange={page.setDateRange}
      persona={page.persona}
      onPersonaChange={(p) => page.setPersona(p as typeof page.persona)}
      entities={page.entities}
      selected={page.selected}
      onSelect={page.setSelected}
      entityLabel={(r) => r.displayName || `${r.owner}/${r.name}`}
      status={page.status}
      error={page.error}
      onRetry={page.retry}
      emptyMessage="No repos tracked yet. Add repos in Settings."
      cardColumns={5}
      cards={
        page.current
          ? [
              {
                title: "Stars",
                value: page.current.stars,
                icon: <Star className="h-4 w-4" />,
                show: showMarketing,
              },
              {
                title: "Forks",
                value: page.current.forks,
                icon: <GitFork className="h-4 w-4" />,
                show: showMarketing,
              },
              {
                title: "Watchers",
                value: page.current.watchers,
                icon: <Eye className="h-4 w-4" />,
                show: showEngineering,
              },
              {
                title: "Open Issues",
                value: page.current.openIssues,
                icon: <CircleDot className="h-4 w-4" />,
                show: showEngineering,
              },
              {
                title: "Contributors",
                value: page.current.contributors,
                icon: <Users className="h-4 w-4" />,
                show: showEngineering,
              },
            ]
          : []
      }
    >
      {metricsData.length > 0 && showMarketing && (
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Stars Over Time</h3>
          <TimeSeriesChart
            data={metricsData.map((d) => ({
              date: d.date,
              stars: d.stars ?? 0,
              forks: d.forks ?? 0,
            }))}
            metrics={[
              { key: "stars", label: "Stars", color: "var(--chart-1)", type: "line" },
              { key: "forks", label: "Forks", color: "var(--chart-2)", type: "line" },
            ]}
            events={page.detail?.events}
            height={350}
          />
        </div>
      )}

      {clonesData.length > 0 && showEngineering && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Clones</h3>
            <TimeSeriesChart
              data={clonesData.map((d) => ({ date: d.date, total: d.total, unique: d.unique }))}
              metrics={[
                { key: "total", label: "Total", color: "var(--chart-3)", type: "bar" },
                { key: "unique", label: "Unique", color: "var(--chart-4)", type: "line" },
              ]}
              height={250}
            />
          </div>
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Views</h3>
            <TimeSeriesChart
              data={viewsData.map((d) => ({ date: d.date, total: d.total, unique: d.unique }))}
              metrics={[
                { key: "total", label: "Total", color: "var(--chart-3)", type: "bar" },
                { key: "unique", label: "Unique", color: "var(--chart-4)", type: "line" },
              ]}
              height={250}
            />
          </div>
        </div>
      )}

      {metricsData.length === 0 && (
        <EmptyNotice message="No GitHub metrics available. Run the data collector first." />
      )}
    </MetricPageShell>
  );
}
