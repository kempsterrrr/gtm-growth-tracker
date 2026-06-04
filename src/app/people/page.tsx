"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MetricCard } from "@/components/charts/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, UserCheck, Building2 } from "lucide-react";
import {
  filterPeopleByEntity,
  filterPeopleByActivity,
  sortPeople,
  type PersonSortSpec,
  type PersonSortKey,
} from "./transforms";
import {
  formatEngagementBreakdown,
  formatRelativeAge,
  type ActivityWindow,
} from "../companies/transforms";
import { todayIso } from "@/lib/dates";
import type { PersonSummary } from "@/lib/types/api";

export default function PeoplePage() {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityWindow>("all");
  const [sort, setSort] = useState<PersonSortSpec | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/people")
      .then((r) => r.json())
      .then((data: PersonSummary[]) => setPeople(data))
      .finally(() => setLoading(false));
  }, []);

  const visible = sortPeople(
    filterPeopleByEntity(filterPeopleByActivity(people, activity, todayIso()), entity),
    sort
  );
  const entityOptions = [
    ...new Set(people.flatMap((p) => p.engagements.map((e) => e.entity))),
  ].sort();

  const toggleSort = (key: PersonSortKey) =>
    setSort((cur) =>
      cur?.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }
    );
  const sortIndicator = (key: PersonSortKey) =>
    sort?.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : "";

  const employed = people.filter((p) => p.primaryCompany).length;
  const employees = people.filter((p) => p.competitorEmployee).length;

  return (
    <div className="flex flex-col h-full">
      <header className="border-b px-6 py-4">
        <h2 className="text-xl font-semibold tracking-tight">People</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every engaged human once — primary employer, provenance, and what they touched
        </p>
      </header>

      <div className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard title="Engaged People" value={people.length} icon={<Users className="h-4 w-4" />} />
          <MetricCard
            title="With Known Employer"
            value={employed}
            icon={<Building2 className="h-4 w-4" />}
          />
          <MetricCard
            title="Competitor Employees"
            value={employees}
            icon={<UserCheck className="h-4 w-4" />}
          />
        </div>

        {!loading && people.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Tabs defaultValue="all">
                <TabsList>
                  <TabsTrigger value="all" onClick={() => setActivity("all")}>
                    Any time
                  </TabsTrigger>
                  <TabsTrigger value="90d" onClick={() => setActivity("90d")}>
                    Active 90d
                  </TabsTrigger>
                  <TabsTrigger value="30d" onClick={() => setActivity("30d")}>
                    Active 30d
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <select
                value={entity ?? ""}
                onChange={(e) => setEntity(e.target.value || null)}
                className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
              >
                <option value="">All entities</option>
                {entityOptions.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                Nobody matches this cut yet.
              </p>
            ) : (
              <div className="border rounded-lg">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium">
                          <button className="hover:text-foreground" onClick={() => toggleSort("login")}>
                            Person{sortIndicator("login")}
                          </button>
                        </th>
                        <th className="text-left px-4 py-2 font-medium">
                          <button
                            className="hover:text-foreground"
                            onClick={() => toggleSort("company")}
                          >
                            Primary Company{sortIndicator("company")}
                          </button>
                        </th>
                        <th className="text-left px-4 py-2 font-medium">Engagement</th>
                        <th className="text-right px-4 py-2 font-medium">
                          <button
                            className="hover:text-foreground"
                            onClick={() => toggleSort("lastActive")}
                          >
                            Last Active{sortIndicator("lastActive")}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((person) => (
                        <tr key={person.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              {person.avatarUrl && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={person.avatarUrl}
                                  alt=""
                                  className="h-6 w-6 rounded-full"
                                />
                              )}
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  <a
                                    href={`https://github.com/${person.login}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline"
                                  >
                                    {person.login}
                                  </a>
                                  {person.competitorEmployee && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs text-amber-600 border-amber-500/60"
                                    >
                                      {person.competitorEmployee} employee
                                    </Badge>
                                  )}
                                </div>
                                {person.name && (
                                  <div className="text-xs text-muted-foreground">{person.name}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            {person.primaryCompany ? (
                              <div className="whitespace-nowrap">
                                <Link
                                  href={`/companies/${person.primaryCompany.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {person.primaryCompany.name}
                                </Link>
                                <span className="text-xs text-muted-foreground">
                                  {" "}
                                  · {person.primaryCompany.source.replace("_", " ")}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="space-y-0.5">
                              {(expanded.has(person.id)
                                ? person.engagements
                                : person.engagements.slice(0, 2)
                              ).map((e) => (
                                <div
                                  key={e.entity}
                                  className={`text-xs ${entity === e.entity ? "font-semibold" : ""}`}
                                >
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
                              {person.engagements.length > 2 && (
                                <button
                                  className="text-xs text-primary hover:underline"
                                  onClick={() =>
                                    setExpanded((cur) => {
                                      const next = new Set(cur);
                                      if (next.has(person.id)) next.delete(person.id);
                                      else next.add(person.id);
                                      return next;
                                    })
                                  }
                                >
                                  {expanded.has(person.id)
                                    ? "show less"
                                    : `+${person.engagements.length - 2} more`}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {person.lastActive
                              ? formatRelativeAge(person.lastActive, todayIso())
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && people.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No engaged people yet</h3>
            <p className="text-muted-foreground max-w-md">
              Run the data collector to gather engagement and enrichment data.
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
