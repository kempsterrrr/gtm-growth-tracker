"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MetricCard } from "@/components/charts/MetricCard";
import { CompanyScoreBar } from "@/components/companies/CompanyScoreBar";
import { Badge } from "@/components/ui/badge";
import { Building2, TrendingUp, Users, Star } from "lucide-react";
import type { CompanySummary } from "@/lib/types/sales-intelligence";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/companies?limit=100")
      .then((r) => r.json())
      .then((data: CompanySummary[]) => setCompanies(data))
      .finally(() => setLoading(false));
  }, []);

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
          Companies detected from GitHub engagement with your repos
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
          <div className="border rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium w-8">#</th>
                    <th className="text-left px-4 py-2 font-medium">Company</th>
                    <th className="text-left px-4 py-2 font-medium">Domain</th>
                    <th className="text-right px-4 py-2 font-medium">Score</th>
                    <th className="text-right px-4 py-2 font-medium">Trend</th>
                    <th className="text-right px-4 py-2 font-medium">Users</th>
                    <th className="text-left px-4 py-2 font-medium w-48">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company, i) => (
                    <tr key={company.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/companies/${company.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {company.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {company.domain || "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {company.score.toFixed(0)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {company.scoreTrend > 0 ? (
                          <Badge variant="secondary" className="text-xs text-green-600">
                            +{company.scoreTrend.toFixed(0)}
                          </Badge>
                        ) : company.scoreTrend < 0 ? (
                          <Badge variant="secondary" className="text-xs text-red-500">
                            {company.scoreTrend.toFixed(0)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{company.userCount}</td>
                      <td className="px-4 py-2">
                        <CompanyScoreBar
                          starCount={company.starCount}
                          forkCount={company.forkCount}
                          issueCount={company.issueCount}
                          prCount={company.prCount}
                          commitCount={company.commitCount}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
