import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { pypiDownloads, trackedPackages } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, isNull, isNotNull } from "drizzle-orm";
import { daysAgoIso } from "@/lib/dates";
import type {
  PypiPackageSummary,
  PypiDownloadRow,
  CompetitorEntitySummary,
} from "@/lib/types/api";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const packageId = searchParams.get("packageId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const db = getDb();

  // Opt-in compare view: competitor-attributed packages with their label.
  if (!packageId && searchParams.get("competitors") === "1") {
    const rows = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "pypi"), isNotNull(trackedPackages.competitor)))
      .all();
    const payload: CompetitorEntitySummary[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      competitor: p.competitor!,
    }));
    return NextResponse.json(payload);
  }

  if (!packageId) {
    const packages = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "pypi"), isNull(trackedPackages.competitor)))
      .all();

    const summaries: PypiPackageSummary[] = packages.map((pkg) => {
      const last7d = db
        .select({ total: sql<number>`SUM(${pypiDownloads.downloads})` })
        .from(pypiDownloads)
        .where(
          and(
            eq(pypiDownloads.packageId, pkg.id),
            eq(pypiDownloads.category, "overall"),
            gte(pypiDownloads.date, daysAgoIso(7))
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

  const data: PypiDownloadRow[] = db
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

