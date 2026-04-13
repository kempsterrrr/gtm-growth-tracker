"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { MetricCard } from "@/components/charts/MetricCard";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import { GitFork } from "lucide-react";

interface DepSummary {
  id: number;
  name: string;
  registry: string;
  displayName: string | null;
  dependentCount: number;
}

interface DepCount {
  date: string;
  count: number;
}

interface Dependent {
  dependentName: string;
  dependentRegistry: string;
  dependentVersion: string | null;
  firstSeen: string;
}

export default function DependenciesPage() {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [packages, setPackages] = useState<DepSummary[]>([]);
  const [selectedPkg, setSelectedPkg] = useState("");
  const [counts, setCounts] = useState<DepCount[]>([]);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/metrics/dependencies")
      .then((r) => r.json())
      .then((data: DepSummary[]) => {
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
    fetch(`/api/metrics/dependencies?${qs}`)
      .then((r) => r.json())
      .then((data: { counts: DepCount[]; dependents: Dependent[] }) => {
        setCounts(data.counts);
        setDependents(data.dependents);
      })
      .finally(() => setLoading(false));
  }, [selectedPkg, dateRange, buildQueryString]);

  const currentPkg = packages.find((p) => String(p.id) === selectedPkg);

  // New dependents in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentDeps = dependents.filter(
    (d) => new Date(d.firstSeen) >= thirtyDaysAgo
  );

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Dependencies"
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
              label: p.displayName || `${p.registry}/${p.name}`,
            }))}
            value={selectedPkg}
            onChange={(e) => setSelectedPkg(e.target.value)}
            className="w-64"
          />
        )}

        {currentPkg && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard
              title="Total Dependents"
              value={currentPkg.dependentCount}
              icon={<GitFork className="h-4 w-4" />}
            />
            <MetricCard title="New This Month" value={recentDeps.length} />
          </div>
        )}

        {!loading && counts.length > 0 && (
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

        {/* Dependents table */}
        {!loading && dependents.length > 0 && (
          <div className="border rounded-lg">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">
                Known Dependents ({dependents.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">Package</th>
                    <th className="text-left px-4 py-2 font-medium">Registry</th>
                    <th className="text-left px-4 py-2 font-medium">Version</th>
                    <th className="text-left px-4 py-2 font-medium">First Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {dependents.map((dep, i) => {
                    const isRecent = new Date(dep.firstSeen) >= thirtyDaysAgo;
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium">
                          {dep.dependentName}
                          {isRecent && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              New
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {dep.dependentRegistry}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {dep.dependentVersion || "-"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {dep.firstSeen}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {packages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No packages tracked. Add packages in Settings.
          </div>
        )}
      </div>
    </div>
  );
}
