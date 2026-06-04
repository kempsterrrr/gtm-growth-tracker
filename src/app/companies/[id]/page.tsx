"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MetricCard } from "@/components/charts/MetricCard";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { CompanyScoreBar, EVENT_TYPE_SCALE } from "@/components/companies/CompanyScoreBar";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Globe, MapPin } from "lucide-react";
import { formatEngagementBreakdown, formatDependentCount, formatRelativeAge } from "../transforms";
import { todayIso } from "@/lib/dates";
import type {
  CompanyDetail,
  CompanyUser,
  CompanySegment,
} from "@/lib/types/sales-intelligence";

const SEGMENT_BADGE: Record<CompanySegment, "default" | "secondary" | "outline"> = {
  prospect: "default",
  battleground: "secondary",
  engaged: "outline",
};

export default function CompanyDetailPage() {
  const { id } = useParams();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/companies/${id}`)
      .then((r) => r.json())
      .then((data: CompanyDetail) => setCompany(data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Company not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b px-6 py-4">
        <Link
          href="/companies"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="h-3 w-3" /> Companies
        </Link>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{company.name}</h2>
          {company.domain && (
            <Badge variant="outline" className="text-xs">
              <Globe className="h-3 w-3 mr-1" />
              {company.domain}
            </Badge>
          )}
          {company.industry && (
            <Badge variant="secondary" className="text-xs">
              {company.industry}
            </Badge>
          )}
          <Badge variant={SEGMENT_BADGE[company.segment]} className="text-xs">
            {company.segment === "prospect" ? "net-new prospect" : company.segment}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Last engaged us:{" "}
          {company.lastOwnEngagementAt
            ? formatRelativeAge(company.lastOwnEngagementAt, todayIso())
            : "—"}{" "}
          · Last on competitor repos:{" "}
          {company.lastCompetitorEngagementAt
            ? formatRelativeAge(company.lastCompetitorEngagementAt, todayIso())
            : "—"}
        </p>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {/* Two scores, two stories — the only numbers that rank this company */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            title="Our Engagement"
            value={company.score.toFixed(0)}
            description={
              company.lastOwnEngagementAt
                ? `last active ${formatRelativeAge(company.lastOwnEngagementAt, todayIso())}`
                : "no live engagement"
            }
          />
          <MetricCard
            title="Competitor Engagement"
            value={company.competitorScore.toFixed(0)}
            description={
              company.lastCompetitorEngagementAt
                ? `last active ${formatRelativeAge(company.lastCompetitorEngagementAt, todayIso())}`
                : company.competitorScore > 0
                  ? "via package dependencies"
                  : "none"
            }
          />
          {company.userCount > 0 && <MetricCard title="People Here" value={company.userCount} />}
        </div>

        {/* Score composition — only when there's something to compose */}
        {company.starCount +
          company.forkCount +
          company.issueCount +
          company.prCount +
          company.commitCount >
          0 && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Engagement Mix</h3>
            <CompanyScoreBar
              starCount={company.starCount}
              forkCount={company.forkCount}
              issueCount={company.issueCount}
              prCount={company.prCount}
              commitCount={company.commitCount}
            />
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
              {EVENT_TYPE_SCALE.map((seg) => (
                <span key={seg.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  {seg.label}: {company[seg.key]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Competitor attribution — which competitor products this company uses */}
        {company.competitorAttribution && company.competitorAttribution.length > 0 && (
          <div className="border rounded-lg">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">Competitor Engagement</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                What drove the competitor score of {company.competitorScore.toFixed(0)}
              </p>
            </div>
            <div className="divide-y">
              {company.competitorAttribution.map((row) => (
                <div key={row.entity} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm">
                      {row.signal === "depends_on" ? (
                        <>
                          ships code on <span className="font-medium">{row.competitor}</span>:{" "}
                          {formatDependentCount(row.dependentCount)} use{" "}
                          <span className="font-medium">{row.displayName || row.entity}</span>
                        </>
                      ) : (
                        <>
                          engages with <span className="font-medium">{row.competitor}</span>:{" "}
                          {formatEngagementBreakdown(row)} on{" "}
                          <span className="font-medium">{row.displayName || row.entity}</span>
                        </>
                      )}
                    </span>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {row.entity}
                      {row.signal === "engagement" &&
                        ` · ${row.userCount} ${row.userCount === 1 ? "user" : "users"}`}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {row.score.toFixed(0)} pts
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Score trend chart */}
        {company.scoreHistory && company.scoreHistory.length > 1 && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Score Over Time
            </h3>
            <TimeSeriesChart
              data={company.scoreHistory.map((s) => ({ date: s.date, score: s.score }))}
              metrics={[
                { key: "score", label: "Score", color: "var(--chart-1)", type: "area" },
              ]}
              height={250}
            />
          </div>
        )}

        {/* Also affiliated — non-primary links: context, not headcount */}
        {company.affiliated && company.affiliated.length > 0 && (
          <details className="border rounded-lg px-4 py-3 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium">
              Also affiliated ({company.affiliated.length}) — linked but employed elsewhere
            </summary>
            <div className="mt-2 space-y-1">
              {company.affiliated.map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span>{a.login}</span>
                  {a.name && <span className="text-xs">({a.name})</span>}
                  <Badge variant="outline" className="text-xs">
                    {a.source.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Users table */}
        {company.users && company.users.length > 0 && (
          <div className="border rounded-lg">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">
                Linked Users ({company.users.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">User</th>
                    <th className="text-left px-4 py-2 font-medium">Source</th>
                    <th className="text-left px-4 py-2 font-medium">Activity</th>
                    <th className="text-right px-4 py-2 font-medium">Entities</th>
                  </tr>
                </thead>
                <tbody>
                  {company.users
                    .sort((a: CompanyUser, b: CompanyUser) => b.engagements.length - a.engagements.length)
                    .map((user: CompanyUser) => (
                      <tr key={user.id} className="border-b last:border-0">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {user.avatarUrl && (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={user.avatarUrl}
                                alt=""
                                className="h-6 w-6 rounded-full"
                              />
                            )}
                            <div>
                              <div className="font-medium flex items-center gap-2">
                                {user.login}
                                {user.competitorEmployee && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs text-amber-600 border-amber-500/60"
                                  >
                                    {user.competitorEmployee} employee
                                  </Badge>
                                )}
                              </div>
                              {user.name && (
                                <div className="text-xs text-muted-foreground">
                                  {user.name}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-xs">
                            {user.source.replace("_", " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="space-y-0.5">
                            {user.engagements.map((e) => (
                              <div key={e.entity} className="text-xs">
                                <span className="font-medium">
                                  {e.competitor ? `${e.competitor} — ` : ""}
                                  {e.displayName || e.entity}
                                </span>
                                <span className="text-muted-foreground">
                                  {" "}
                                  {formatEngagementBreakdown(e)}
                                  {e.competitor && " (competitor)"}
                                  {e.lastAt && ` · ${formatRelativeAge(e.lastAt, todayIso())}`}
                                </span>
                              </div>
                            ))}
                            {user.engagements.length === 0 && (
                              <span className="text-xs text-muted-foreground">
                                no engagement recorded
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {user.engagements.length}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
