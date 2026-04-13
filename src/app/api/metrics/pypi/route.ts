import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { pypiDownloads, trackedPackages } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const packageId = searchParams.get("packageId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = getDb();

  if (!packageId) {
    const packages = db
      .select()
      .from(trackedPackages)
      .where(eq(trackedPackages.registry, "pypi"))
      .all();

    const summaries = packages.map((pkg) => {
      const last7d = db
        .select({ total: sql<number>`SUM(${pypiDownloads.downloads})` })
        .from(pypiDownloads)
        .where(
          and(
            eq(pypiDownloads.packageId, pkg.id),
            eq(pypiDownloads.category, "overall"),
            gte(pypiDownloads.date, getDateDaysAgo(7))
          )
        )
        .get();

      return {
        id: pkg.id,
        name: pkg.name,
        displayName: pkg.displayName,
        downloadsLast7d: last7d?.total || 0,
      };
    });

    return NextResponse.json(summaries);
  }

  const conditions = [
    eq(pypiDownloads.packageId, parseInt(packageId)),
    eq(pypiDownloads.category, "overall"),
  ];
  if (startDate) conditions.push(gte(pypiDownloads.date, startDate));
  if (endDate) conditions.push(lte(pypiDownloads.date, endDate));

  const data = db
    .select({
      date: pypiDownloads.date,
      downloads: pypiDownloads.downloads,
      categoryValue: pypiDownloads.categoryValue,
    })
    .from(pypiDownloads)
    .where(and(...conditions))
    .orderBy(pypiDownloads.date)
    .all();

  return NextResponse.json(data);
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}
