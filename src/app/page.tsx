"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { MetricCard } from "@/components/charts/MetricCard";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Button } from "@/components/ui/button";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import { fetchJson } from "@/components/metric-page/use-metric-page";
import { Star, Download, GitFork, Package } from "lucide-react";
import type {
  NpmPackageSummary,
  GithubRepoSummary,
  DependencySummary,
  DownloadRow,
  TrackedEvent,
} from "@/lib/types/api";

interface OverviewData {
  npmPackages: NpmPackageSummary[];
  githubRepos: GithubRepoSummary[];
  depSummaries: DependencySummary[];
  events: TrackedEvent[];
  chartData: Array<{ date: string; downloads: number }>;
}

export default function OverviewPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  // Keyed on the date range so stale responses are ignored and loading is
  // derived — no synchronous setState inside the effect.
  const [data, setData] = useState<{ key: string; value: OverviewData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const key = dateRange;
    (async () => {
      try {
        const [npmPackages, githubRepos, depSummaries, events] = await Promise.all([
          fetchJson<NpmPackageSummary[]>("/api/metrics/npm"),
          fetchJson<GithubRepoSummary[]>("/api/metrics/github"),
          fetchJson<DependencySummary[]>("/api/metrics/dependencies"),
          fetchJson<TrackedEvent[]>(`/api/events?${buildQueryString()}`),
        ]);

        let chartData: Array<{ date: string; downloads: number }> = [];
        if (npmPackages.length > 0) {
          const qs = buildQueryString({ packageId: String(npmPackages[0].id) });
          const raw = await fetchJson<DownloadRow[]>(`/api/metrics/npm?${qs}`);
          chartData = raw.map((d) => ({ date: d.date, downloads: d.downloads }));
        }

        if (!cancelled) {
          setData({ key, value: { npmPackages, githubRepos, depSummaries, events, chartData } });
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateRange, buildQueryString, retryToken]);

  const current = data && data.key === dateRange ? data.value : null;
  const loading = !error && current === null;

  const npmPackages = current?.npmPackages ?? [];
  const githubRepos = current?.githubRepos ?? [];
  const depSummaries = current?.depSummaries ?? [];

  const totalStars = githubRepos.reduce((s, r) => s + r.stars, 0);
  const totalForks = githubRepos.reduce((s, r) => s + r.forks, 0);
  const totalDownloads7d = npmPackages.reduce((s, p) => s + p.downloadsLast7d, 0);
  const avgGrowth =
    npmPackages.length > 0
      ? npmPackages.reduce((s, p) => s + p.growthPercent7d, 0) / npmPackages.length
      : 0;
  const totalDependents = depSummaries.reduce((s, d) => s + d.dependentCount, 0);

  const showMarketing = persona === "all" || persona === "marketing" || persona === "gtm";
  const showSales = persona === "all" || persona === "sales" || persona === "gtm";
  const showEngineering = persona === "all" || persona === "engineering" || persona === "gtm";

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Overview"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        persona={persona}
        onPersonaChange={(p) => setPersona(p as typeof persona)}
      />

      <div className="flex-1 p-6 space-y-6">
        {error && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-destructive">Failed to load data: {error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                setRetryToken((t) => t + 1);
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading metrics...
          </div>
        )}

        {current && npmPackages.length === 0 && githubRepos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No packages tracked yet</h3>
            <p className="text-muted-foreground max-w-md">
              Go to Settings to add GitHub repos and npm/PyPI packages to track,
              then run the data collector to start seeing metrics.
            </p>
          </div>
        )}

        {current && (npmPackages.length > 0 || githubRepos.length > 0) && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {showMarketing && (
                <>
                  <MetricCard
                    title="Total Stars"
                    value={totalStars}
                    icon={<Star className="h-4 w-4" />}
                  />
                  <MetricCard
                    title="Weekly Downloads"
                    value={totalDownloads7d}
                    delta={avgGrowth}
                    description="vs previous week"
                    icon={<Download className="h-4 w-4" />}
                  />
                </>
              )}
              {showSales && (
                <MetricCard
                  title="Reverse Dependents"
                  value={totalDependents}
                  icon={<GitFork className="h-4 w-4" />}
                />
              )}
              {showEngineering && (
                <MetricCard
                  title="Total Forks"
                  value={totalForks}
                  icon={<GitFork className="h-4 w-4" />}
                />
              )}
            </div>

            {/* Main Chart */}
            {current.chartData.length > 0 && (
              <div className="border rounded-lg p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-4">
                  Downloads Over Time
                  {npmPackages.length > 0 &&
                    ` - ${npmPackages[0].displayName || npmPackages[0].name}`}
                </h3>
                <TimeSeriesChart
                  data={current.chartData}
                  metrics={[
                    {
                      key: "downloads",
                      label: "Downloads",
                      color: "var(--chart-1)",
                      type: "area",
                    },
                  ]}
                  events={current.events}
                />
              </div>
            )}

            {/* Package Overview (the dead empty-sparkline path is gone) */}
            {npmPackages.length > 1 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Package Overview
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {npmPackages.map((pkg) => (
                    <MetricCard
                      key={pkg.id}
                      title={pkg.displayName || pkg.name}
                      value={`${pkg.downloadsLast7d.toLocaleString()} / week`}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
