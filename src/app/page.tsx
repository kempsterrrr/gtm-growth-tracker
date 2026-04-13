"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { MetricCard } from "@/components/charts/MetricCard";
import { SparklineCard } from "@/components/charts/SparklineCard";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import { Star, Download, GitFork, Package } from "lucide-react";
import type { EventCategory } from "@/lib/types/events";

interface NpmSummary {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
  growthPercent7d: number;
}

interface GithubSummary {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
  stars: number;
  forks: number;
}

interface DepSummary {
  id: number;
  name: string;
  registry: string;
  dependentCount: number;
}

interface DownloadRow {
  date: string;
  downloads: number;
}

interface EventRow {
  date: string;
  title: string;
  category: EventCategory;
  description?: string;
}

export default function OverviewPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [npmPackages, setNpmPackages] = useState<NpmSummary[]>([]);
  const [githubRepos, setGithubRepos] = useState<GithubSummary[]>([]);
  const [depSummaries, setDepSummaries] = useState<DepSummary[]>([]);
  const [chartData, setChartData] = useState<Record<string, string | number>[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [npmRes, ghRes, depRes, eventsRes] = await Promise.all([
          fetch("/api/metrics/npm"),
          fetch("/api/metrics/github"),
          fetch("/api/metrics/dependencies"),
          fetch(`/api/events?${buildQueryString()}`),
        ]);

        const npmData: NpmSummary[] = await npmRes.json();
        const ghData: GithubSummary[] = await ghRes.json();
        const depData: DepSummary[] = await depRes.json();
        const eventsData: EventRow[] = await eventsRes.json();

        setNpmPackages(npmData);
        setGithubRepos(ghData);
        setDepSummaries(depData);
        setEvents(eventsData);

        // If there are npm packages, fetch chart data for the first one
        if (npmData.length > 0) {
          const qs = buildQueryString({ packageId: String(npmData[0].id) });
          const chartRes = await fetch(`/api/metrics/npm?${qs}`);
          const raw: DownloadRow[] = await chartRes.json();
          setChartData(
            raw.map((d) => ({
              date: d.date,
              downloads: d.downloads,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to fetch overview data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [dateRange, buildQueryString]);

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
        {loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading metrics...
          </div>
        )}

        {!loading && npmPackages.length === 0 && githubRepos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No packages tracked yet</h3>
            <p className="text-muted-foreground max-w-md">
              Go to Settings to add GitHub repos and npm/PyPI packages to track,
              then run the data collector to start seeing metrics.
            </p>
          </div>
        )}

        {!loading && (npmPackages.length > 0 || githubRepos.length > 0) && (
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
            {chartData.length > 0 && (
              <div className="border rounded-lg p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-4">
                  Downloads Over Time
                  {npmPackages.length > 0 &&
                    ` - ${npmPackages[0].displayName || npmPackages[0].name}`}
                </h3>
                <TimeSeriesChart
                  data={chartData}
                  metrics={[
                    {
                      key: "downloads",
                      label: "Downloads",
                      color: "var(--chart-1)",
                      type: "area",
                    },
                  ]}
                  events={events}
                />
              </div>
            )}

            {/* Sparkline Cards */}
            {npmPackages.length > 1 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Package Overview
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {npmPackages.map((pkg) => (
                    <SparklineCard
                      key={pkg.id}
                      title={pkg.displayName || pkg.name}
                      value={`${pkg.downloadsLast7d.toLocaleString()} / week`}
                      data={[]}
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
