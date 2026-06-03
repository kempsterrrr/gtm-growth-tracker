import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { npmDownloads, trackedPackages } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc, isNull } from "drizzle-orm";
import { daysAgoIso, growthPercent } from "@/lib/dates";
import type { NpmPackageSummary, DownloadRow } from "@/lib/types/api";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const packageId = searchParams.get("packageId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = getDb();

  // If no packageId, return all packages with summary
  if (!packageId) {
    const packages = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "npm"), isNull(trackedPackages.competitor)))
      .all();

    const summaries: NpmPackageSummary[] = packages.map((pkg) => {
      const last7d = db
        .select({ total: sql<number>`SUM(${npmDownloads.downloads})` })
        .from(npmDownloads)
        .where(
          and(
            eq(npmDownloads.packageId, pkg.id),
            gte(npmDownloads.date, daysAgoIso(7))
          )
        )
        .get();

      const prev7d = db
        .select({ total: sql<number>`SUM(${npmDownloads.downloads})` })
        .from(npmDownloads)
        .where(
          and(
            eq(npmDownloads.packageId, pkg.id),
            gte(npmDownloads.date, daysAgoIso(14)),
            lte(npmDownloads.date, daysAgoIso(7))
          )
        )
        .get();

      const current = last7d?.total || 0;
      const previous = prev7d?.total || 0;
      const growth = growthPercent(current, previous);

      return {
        id: pkg.id,
        name: pkg.name,
        displayName: pkg.displayName,
        downloadsLast7d: current,
        growthPercent7d: growth,
      };
    });

    return NextResponse.json(summaries);
  }

  // Return time series for a specific package
  const conditions = [eq(npmDownloads.packageId, parseInt(packageId))];
  if (startDate) conditions.push(gte(npmDownloads.date, startDate));
  if (endDate) conditions.push(lte(npmDownloads.date, endDate));

  const data: DownloadRow[] = db
    .select({
      date: npmDownloads.date,
      downloads: npmDownloads.downloads,
    })
    .from(npmDownloads)
    .where(and(...conditions))
    .orderBy(npmDownloads.date)
    .all();

  return NextResponse.json(data);
}

