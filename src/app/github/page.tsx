"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { MetricCard } from "@/components/charts/MetricCard";
import { Select } from "@/components/ui/select";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import { Star, GitFork, Eye, CircleDot, Users } from "lucide-react";
import type { EventCategory } from "@/lib/types/events";

interface GithubRepo {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  contributors: number;
}

interface MetricRow {
  date: string;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  contributors: number | null;
}

interface TrafficRow {
  date: string;
  total: number;
  unique: number;
}

interface EventRow {
  date: string;
  title: string;
  category: EventCategory;
  description?: string;
}

export default function GithubPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [metricsData, setMetricsData] = useState<MetricRow[]>([]);
  const [clonesData, setClonesData] = useState<TrafficRow[]>([]);
  const [viewsData, setViewsData] = useState<TrafficRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/metrics/github")
      .then((r) => r.json())
      .then((data: GithubRepo[]) => {
        setRepos(data);
        if (data.length > 0 && !selectedRepo) {
          setSelectedRepo(String(data[0].id));
        }
      });
  }, []);

  useEffect(() => {
    if (!selectedRepo) return;
    setLoading(true);

    const qs = buildQueryString({ repoId: selectedRepo, metric: "all" });

    Promise.all([
      fetch(`/api/metrics/github?${qs}`).then((r) => r.json()),
      fetch(`/api/events?${buildQueryString({ repoId: selectedRepo })}`).then((r) =>
        r.json()
      ),
    ])
      .then(([data, evts]: [{ metrics?: MetricRow[]; clones?: TrafficRow[]; views?: TrafficRow[] }, EventRow[]]) => {
        setMetricsData(data.metrics || []);
        setClonesData(data.clones || []);
        setViewsData(data.views || []);
        setEvents(evts);
      })
      .finally(() => setLoading(false));
  }, [selectedRepo, dateRange, buildQueryString]);

  const currentRepo = repos.find((r) => String(r.id) === selectedRepo);

  const showMarketing = persona === "all" || persona === "marketing" || persona === "gtm";
  const showEngineering = persona === "all" || persona === "engineering" || persona === "gtm";

  return (
    <div className="flex flex-col h-full">
      <Header
        title="GitHub Metrics"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        persona={persona}
        onPersonaChange={(p) => setPersona(p as typeof persona)}
      />

      <div className="flex-1 p-6 space-y-6">
        {repos.length > 0 && (
          <Select
            options={repos.map((r) => ({
              value: String(r.id),
              label: r.displayName || `${r.owner}/${r.name}`,
            }))}
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            className="w-64"
          />
        )}

        {currentRepo && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {showMarketing && (
              <>
                <MetricCard
                  title="Stars"
                  value={currentRepo.stars}
                  icon={<Star className="h-4 w-4" />}
                />
                <MetricCard
                  title="Forks"
                  value={currentRepo.forks}
                  icon={<GitFork className="h-4 w-4" />}
                />
              </>
            )}
            {showEngineering && (
              <>
                <MetricCard
                  title="Watchers"
                  value={currentRepo.watchers}
                  icon={<Eye className="h-4 w-4" />}
                />
                <MetricCard
                  title="Open Issues"
                  value={currentRepo.openIssues}
                  icon={<CircleDot className="h-4 w-4" />}
                />
                <MetricCard
                  title="Contributors"
                  value={currentRepo.contributors}
                  icon={<Users className="h-4 w-4" />}
                />
              </>
            )}
          </div>
        )}

        {!loading && metricsData.length > 0 && showMarketing && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Stars Over Time
            </h3>
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
              events={events}
              height={350}
            />
          </div>
        )}

        {!loading && clonesData.length > 0 && showEngineering && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Clones
              </h3>
              <TimeSeriesChart
                data={clonesData.map((d) => ({
                  date: d.date,
                  total: d.total,
                  unique: d.unique,
                }))}
                metrics={[
                  { key: "total", label: "Total", color: "var(--chart-3)", type: "bar" },
                  { key: "unique", label: "Unique", color: "var(--chart-4)", type: "line" },
                ]}
                height={250}
              />
            </div>
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Views
              </h3>
              <TimeSeriesChart
                data={viewsData.map((d) => ({
                  date: d.date,
                  total: d.total,
                  unique: d.unique,
                }))}
                metrics={[
                  { key: "total", label: "Total", color: "var(--chart-3)", type: "bar" },
                  { key: "unique", label: "Unique", color: "var(--chart-4)", type: "line" },
                ]}
                height={250}
              />
            </div>
          </div>
        )}

        {!loading && metricsData.length === 0 && repos.length > 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No GitHub metrics available. Run the data collector first.
          </div>
        )}

        {repos.length === 0 && !loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No repos tracked yet. Add repos in Settings.
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
