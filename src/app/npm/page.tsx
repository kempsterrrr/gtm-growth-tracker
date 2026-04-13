"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { MetricCard } from "@/components/charts/MetricCard";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import type { EventCategory } from "@/lib/types/events";

interface NpmPackage {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
  growthPercent7d: number;
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

function aggregateWeekly(data: DownloadRow[]): Record<string, string | number>[] {
  const weeks: Record<string, number> = {};
  for (const d of data) {
    const date = new Date(d.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().split("T")[0];
    weeks[key] = (weeks[key] || 0) + d.downloads;
  }
  return Object.entries(weeks).map(([date, downloads]) => ({ date, downloads }));
}

function aggregateMonthly(data: DownloadRow[]): Record<string, string | number>[] {
  const months: Record<string, number> = {};
  for (const d of data) {
    const key = d.date.slice(0, 7) + "-01";
    months[key] = (months[key] || 0) + d.downloads;
  }
  return Object.entries(months).map(([date, downloads]) => ({ date, downloads }));
}

export default function NpmPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [packages, setPackages] = useState<NpmPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string>("");
  const [chartData, setChartData] = useState<DownloadRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [aggregation, setAggregation] = useState("daily");
  const [loading, setLoading] = useState(true);

  // Fetch package list
  useEffect(() => {
    fetch("/api/metrics/npm")
      .then((r) => r.json())
      .then((data: NpmPackage[]) => {
        setPackages(data);
        if (data.length > 0 && !selectedPkg) {
          setSelectedPkg(String(data[0].id));
        }
      });
  }, []);

  // Fetch chart data when selection changes
  useEffect(() => {
    if (!selectedPkg) return;
    setLoading(true);

    const qs = buildQueryString({ packageId: selectedPkg });

    Promise.all([
      fetch(`/api/metrics/npm?${qs}`).then((r) => r.json()),
      fetch(`/api/events?${buildQueryString()}`).then((r) => r.json()),
    ])
      .then(([downloads, evts]: [DownloadRow[], EventRow[]]) => {
        setChartData(downloads);
        setEvents(evts);
      })
      .finally(() => setLoading(false));
  }, [selectedPkg, dateRange, buildQueryString]);

  const currentPkg = packages.find((p) => String(p.id) === selectedPkg);

  const displayData =
    aggregation === "weekly"
      ? aggregateWeekly(chartData)
      : aggregation === "monthly"
        ? aggregateMonthly(chartData)
        : chartData.map((d) => ({ date: d.date, downloads: d.downloads }));

  const totalDownloads = chartData.reduce((s, d) => s + d.downloads, 0);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="npm Downloads"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        persona={persona}
        onPersonaChange={(p) => setPersona(p as typeof persona)}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Package selector */}
        {packages.length > 0 && (
          <div className="flex items-center gap-4">
            <Select
              options={packages.map((p) => ({
                value: String(p.id),
                label: p.displayName || p.name,
              }))}
              value={selectedPkg}
              onChange={(e) => setSelectedPkg(e.target.value)}
              className="w-64"
            />
          </div>
        )}

        {/* Metric cards */}
        {currentPkg && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              title="Weekly Downloads"
              value={currentPkg.downloadsLast7d}
              delta={currentPkg.growthPercent7d}
              description="vs previous week"
            />
            <MetricCard
              title="Total in Period"
              value={totalDownloads}
            />
          </div>
        )}

        {/* Chart */}
        {!loading && displayData.length > 0 && (
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Downloads - {currentPkg?.displayName || currentPkg?.name}
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
              events={events}
              height={400}
            />
          </div>
        )}

        {!loading && chartData.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No download data available. Run the data collector first.
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
