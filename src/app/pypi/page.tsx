"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { MetricCard } from "@/components/charts/MetricCard";
import { Select } from "@/components/ui/select";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import type { EventCategory } from "@/lib/types/events";

interface PypiPackage {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
}

interface DownloadRow {
  date: string;
  downloads: number;
  categoryValue: string | null;
}

interface EventRow {
  date: string;
  title: string;
  category: EventCategory;
}

export default function PypiPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [packages, setPackages] = useState<PypiPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState("");
  const [chartData, setChartData] = useState<DownloadRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/metrics/pypi")
      .then((r) => r.json())
      .then((data: PypiPackage[]) => {
        setPackages(data);
        if (data.length > 0 && !selectedPkg) {
          setSelectedPkg(String(data[0].id));
        }
      });
  }, []);

  useEffect(() => {
    if (!selectedPkg) return;
    setLoading(true);

    const qs = buildQueryString({ packageId: selectedPkg });

    Promise.all([
      fetch(`/api/metrics/pypi?${qs}`).then((r) => r.json()),
      fetch(`/api/events?${buildQueryString()}`).then((r) => r.json()),
    ])
      .then(([downloads, evts]: [DownloadRow[], EventRow[]]) => {
        setChartData(downloads);
        setEvents(evts);
      })
      .finally(() => setLoading(false));
  }, [selectedPkg, dateRange, buildQueryString]);

  const currentPkg = packages.find((p) => String(p.id) === selectedPkg);

  // Aggregate by date (sum across categoryValues like "with_mirrors" and "without_mirrors")
  const aggregated = Object.values(
    chartData.reduce<Record<string, { date: string; downloads: number }>>((acc, d) => {
      if (!acc[d.date]) acc[d.date] = { date: d.date, downloads: 0 };
      acc[d.date].downloads += d.downloads;
      return acc;
    }, {})
  ).sort((a, b) => a.date.localeCompare(b.date));

  const totalInPeriod = aggregated.reduce((s, d) => s + d.downloads, 0);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="PyPI Downloads"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        persona={persona}
        onPersonaChange={(p) => setPersona(p as typeof persona)}
      />

      <div className="flex-1 p-6 space-y-6">
        {packages.length > 0 && (
          <Select
            options={packages.map((p) => ({
              value: String(p.id),
              label: p.displayName || p.name,
            }))}
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            className="w-64"
          />
        )}

        {currentPkg && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard title="Weekly Downloads" value={currentPkg.downloadsLast7d} />
            <MetricCard title="Total in Period" value={totalInPeriod} />
          </div>
        )}

        {!loading && aggregated.length > 0 && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Downloads - {currentPkg?.displayName || currentPkg?.name}
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
              events={events}
              height={400}
            />
          </div>
        )}

        {!loading && aggregated.length === 0 && packages.length > 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No PyPI data available. Run the data collector first.
          </div>
        )}

        {packages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No PyPI packages tracked. Add packages in Settings.
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
