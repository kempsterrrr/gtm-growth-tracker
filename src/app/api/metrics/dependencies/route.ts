import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  reverseDependencies,
  reverseDependencyCounts,
  trackedPackages,
} from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const packageId = searchParams.get("packageId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = getDb();

  if (!packageId) {
    // Return all packages with their latest dep counts
    const packages = db.select().from(trackedPackages).all();

    const summaries = packages.map((pkg) => {
      const latest = db
        .select()
        .from(reverseDependencyCounts)
        .where(eq(reverseDependencyCounts.packageId, pkg.id))
        .orderBy(desc(reverseDependencyCounts.date))
        .limit(1)
        .get();

      return {
        id: pkg.id,
        name: pkg.name,
        registry: pkg.registry,
        displayName: pkg.displayName,
        dependentCount: latest?.count || 0,
      };
    });

    return NextResponse.json(summaries);
  }

  const id = parseInt(packageId);

  // Get time series of dependency counts
  const countConditions = [eq(reverseDependencyCounts.packageId, id)];
  if (startDate) countConditions.push(gte(reverseDependencyCounts.date, startDate));
  if (endDate) countConditions.push(lte(reverseDependencyCounts.date, endDate));

  const counts = db
    .select({
      date: reverseDependencyCounts.date,
      count: reverseDependencyCounts.count,
    })
    .from(reverseDependencyCounts)
    .where(and(...countConditions))
    .orderBy(reverseDependencyCounts.date)
    .all();

  // Get list of individual dependents
  const dependents = db
    .select({
      dependentName: reverseDependencies.dependentName,
      dependentRegistry: reverseDependencies.dependentRegistry,
      dependentVersion: reverseDependencies.dependentVersion,
      firstSeen: reverseDependencies.firstSeen,
    })
    .from(reverseDependencies)
    .where(eq(reverseDependencies.packageId, id))
    .orderBy(desc(reverseDependencies.firstSeen))
    .all();

  return NextResponse.json({ counts, dependents });
}
