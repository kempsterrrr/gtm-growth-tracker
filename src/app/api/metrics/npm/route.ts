import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { npmDownloads, trackedPackages } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const packageId = searchParams.get("packageId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = getDb();

  // If no packageId, return all packages with summary
  if (!packageId) {
    const packages = db.select().from(trackedPackages).where(eq(trackedPackages.registry, "npm")).all();

    const summaries = packages.map((pkg) => {
      const last7d = db
        .select({ total: sql<number>`SUM(${npmDownloads.downloads})` })
        .from(npmDownloads)
        .where(
          and(
            eq(npmDownloads.packageId, pkg.id),
            gte(npmDownloads.date, getDateDaysAgo(7))
          )
        )
        .get();

      const prev7d = db
        .select({ total: sql<number>`SUM(${npmDownloads.downloads})` })
        .from(npmDownloads)
        .where(
          and(
            eq(npmDownloads.packageId, pkg.id),
            gte(npmDownloads.date, getDateDaysAgo(14)),
            lte(npmDownloads.date, getDateDaysAgo(7))
          )
        )
        .get();

      const current = last7d?.total || 0;
      const previous = prev7d?.total || 0;
      const growth = previous > 0 ? ((current - previous) / previous) * 100 : 0;

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

  const data = db
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

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}
