"use client";

import { Badge } from "@/components/ui/badge";
import type { DependentRow } from "@/lib/types/api";

/** The known-dependents table (moved verbatim from the dependencies page). */
export function DependentsTable({
  dependents,
  thirtyDaysAgo,
}: {
  dependents: DependentRow[];
  thirtyDaysAgo: Date;
}) {
  return (
    <div className="border rounded-lg">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-medium">Known Dependents ({dependents.length})</h3>
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
                  <td className="px-4 py-2 text-muted-foreground">{dep.dependentRegistry}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {dep.dependentVersion || "-"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{dep.firstSeen}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
