"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MetricCard } from "@/components/charts/MetricCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, TrendingUp, Users, Star } from "lucide-react";
import {
  filterCompanies,
  sortCompanies,
  filterByActivity,
  filterByEntity,
  latestActivity,
  formatRelativeAge,
  type SegmentFilter,
  type SortSpec,
  type SortKey,
  type ActivityWindow,
} from "./transforms";
import { todayIso } from "@/lib/dates";
import type { CompanySummary, CompanySegment } from "@/lib/types/sales-intelligence";

const SEGMENT_DOT: Record<CompanySegment, string> = {
  prospect: "bg-primary",
  battleground: "bg-amber-500",
  engaged: "bg-muted-foreground/40",
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<SegmentFilter>("all");
  const [activity, setActivity] = useState<ActivityWindow>("all");
  const [entity, setEntity] = useState<string | null>(null);
  const [sort, setSort] = useState<SortSpec | null>(null);

  useEffect(() => {
    fetch("/api/companies?limit=100")
      .then((r) => r.json())
      .then((data: CompanySummary[]) => setCompanies(data))
      .finally(() => setLoading(false));
  }, []);

  const visible = sortCompanies(
    filterByEntity(filterByActivity(filterCompanies(companies, segment), activity, todayIso()), entity),
    sort
  );
  const entityOptions = [...new Set(companies.flatMap((c) => c.activeEntities))].sort();

  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur?.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }
    );
  const sortIndicator = (key: SortKey) =>
    sort?.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : "";

  const totalCompanies = companies.length;
  const topScore = companies[0]?.score || 0;
  const totalUsers = companies.reduce((s, c) => s + c.userCount, 0);
  const topMover = companies.reduce(
    (best, c) => (c.scoreTrend > (best?.scoreTrend || 0) ? c : best),
    null as CompanySummary | null
  );

  return (
    <div className="flex flex-col h-full">
      <header className="border-b px-6 py-4">
        <h2 className="text-xl font-semibold tracking-tight">Companies</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Companies detected from GitHub engagement with your repos and your competitors&apos;
        </p>
      </header>

      <div className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            title="Companies Detected"
            value={totalCompanies}
            icon={<Building2 className="h-4 w-4" />}
          />
          <MetricCard
            title="Top Score"
            value={topScore.toFixed(0)}
            icon={<Star className="h-4 w-4" />}
          />
          <MetricCard
            title="Total Users Linked"
            value={totalUsers}
            icon={<Users className="h-4 w-4" />}
          />
          {topMover && topMover.scoreTrend > 0 && (
            <MetricCard
              title="Top Mover"
              value={topMover.name}
              description={`+${topMover.scoreTrend.toFixed(0)} this week`}
              icon={<TrendingUp className="h-4 w-4" />}
            />
          )}
        </div>

        {!loading && companies.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Tabs defaultValue="all">
                <TabsList>
                  <TabsTrigger value="all" onClick={() => setSegment("all")}>
                    All
                  </TabsTrigger>
                  <TabsTrigger value="engaged" onClick={() => setSegment("engaged")}>
                    Engaged
                  </TabsTrigger>
                  <TabsTrigger value="battleground" onClick={() => setSegment("battleground")}>
                    Battleground
                  </TabsTrigger>
                  <TabsTrigger value="prospect" onClick={() => setSegment("prospect")}>
                    Net-new Prospect
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {/* Narrowing controls: quieter, right-aligned — the segment
                  tabs are the view; these are refinements. */}
              <div className="flex items-center gap-2 ml-auto text-sm">
                <Tabs defaultValue="all">
                  <TabsList className="h-8">
                    <TabsTrigger value="all" onClick={() => setActivity("all")}>
                      Any time
                    </TabsTrigger>
                    <TabsTrigger value="90d" onClick={() => setActivity("90d")}>
                      90d
                    </TabsTrigger>
                    <TabsTrigger value="30d" onClick={() => setActivity("30d")}>
                      30d
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <select
                  value={entity ?? ""}
                  onChange={(e) => setEntity(e.target.value || null)}
                  className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-muted-foreground"
                >
                  <option value="">All entities</option>
                  {entityOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                No {segment === "all" ? "" : segment + " "}companies yet.
              </p>
            ) : (
              <div className="border rounded-lg">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium">
                          <button className="hover:text-foreground" onClick={() => toggleSort("name")}>
                            Company{sortIndicator("name")}
                          </button>
                        </th>
                        <th className="text-right px-4 py-2 font-medium">
                          <button
                            className="hover:text-foreground"
                            onClick={() => toggleSort("score")}
                          >
                            Score{sortIndicator("score")}
                          </button>
                        </th>
                        <th className="text-right px-4 py-2 font-medium">
                          <button
                            className="hover:text-foreground"
                            onClick={() => toggleSort("competitorScore")}
                          >
                            Competitor{sortIndicator("competitorScore")}
                          </button>
                        </th>
                        <th className="text-right px-4 py-2 font-medium whitespace-nowrap">
                          <button
                            className="hover:text-foreground"
                            onClick={() => toggleSort("lastActive")}
                          >
                            Last Active{sortIndicator("lastActive")}
                          </button>
                        </th>
                        <th className="text-right px-4 py-2 font-medium">
                          <button className="hover:text-foreground" onClick={() => toggleSort("trend")}>
                            Trend{sortIndicator("trend")}
                          </button>
                        </th>
                        <th className="text-right px-4 py-2 font-medium">
                          <button className="hover:text-foreground" onClick={() => toggleSort("users")}>
                            Users{sortIndicator("users")}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((company) => (
                        <tr key={company.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              {segment === "all" && (
                                <span
                                  className={`inline-block h-2 w-2 rounded-full shrink-0 ${SEGMENT_DOT[company.segment]}`}
                                  title={company.segment}
                                />
                              )}
                              <Link
                                href={`/companies/${company.id}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {company.name}
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            {company.score.toFixed(0)}
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            {company.competitorScore > 0
                              ? company.competitorScore.toFixed(0)
                              : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground whitespace-nowrap">
                            {latestActivity(company)
                              ? formatRelativeAge(latestActivity(company)!, todayIso())
                              : "—"}
                          </td>
                          <td
                            className={`px-4 py-2 text-right text-xs whitespace-nowrap ${
                              Math.abs(company.scoreTrend) >= 10
                                ? company.scoreTrend > 0
                                  ? "text-green-600 font-medium"
                                  : "text-red-500 font-medium"
                                : "text-muted-foreground"
                            }`}
                          >
                            {company.scoreTrend > 0
                              ? `↑ ${company.scoreTrend.toFixed(0)}`
                              : company.scoreTrend < 0
                                ? `↓ ${Math.abs(company.scoreTrend).toFixed(0)}`
                                : "—"}
                          </td>
                          <td className="px-4 py-2 text-right">{company.userCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && companies.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No companies detected yet</h3>
            <p className="text-muted-foreground max-w-md">
              Run the data collector to gather GitHub engagement data and detect companies from user profiles, emails, and org memberships.
            </p>
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
