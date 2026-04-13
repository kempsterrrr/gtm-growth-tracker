import { getDb } from "../db/client";
import { trackedPackages, npmDownloads } from "../db/schema";
import { getNpmRangeDownloads } from "../api-clients/npm-client";
import { eq, sql } from "drizzle-orm";

export async function collectNpmDownloads() {
  const db = getDb();
  const packages = db
    .select()
    .from(trackedPackages)
    .where(eq(trackedPackages.registry, "npm"))
    .all();

  if (packages.length === 0) {
    console.log("[npm] No packages to collect");
    return;
  }

  // Collect yesterday's data
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  for (const pkg of packages) {
    try {
      console.log(`[npm] Collecting ${pkg.name} for ${dateStr}...`);
      const downloads = await getNpmRangeDownloads(pkg.name, dateStr, dateStr);

      for (const day of downloads) {
        db.insert(npmDownloads)
          .values({
            packageId: pkg.id,
            date: day.day,
            downloads: day.downloads,
          })
          .onConflictDoUpdate({
            target: [npmDownloads.packageId, npmDownloads.date],
            set: { downloads: sql`excluded.downloads` },
          })
          .run();
      }

      console.log(
        `[npm] ${pkg.name}: ${downloads.reduce((s, d) => s + d.downloads, 0)} downloads`
      );
    } catch (err) {
      console.error(`[npm] Error collecting ${pkg.name}:`, err);
    }
  }
}

export async function backfillNpmDownloads(fromDate: string) {
  const db = getDb();
  const packages = db
    .select()
    .from(trackedPackages)
    .where(eq(trackedPackages.registry, "npm"))
    .all();

  if (packages.length === 0) {
    console.log("[npm backfill] No packages to backfill");
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const endDate = yesterday.toISOString().split("T")[0];

  for (const pkg of packages) {
    try {
      console.log(`[npm backfill] Fetching ${pkg.name} from ${fromDate} to ${endDate}...`);
      const downloads = await getNpmRangeDownloads(pkg.name, fromDate, endDate);

      let totalDownloads = 0;
      for (const day of downloads) {
        db.insert(npmDownloads)
          .values({
            packageId: pkg.id,
            date: day.day,
            downloads: day.downloads,
          })
          .onConflictDoUpdate({
            target: [npmDownloads.packageId, npmDownloads.date],
            set: { downloads: sql`excluded.downloads` },
          })
          .run();
        totalDownloads += day.downloads;
      }

      console.log(
        `[npm backfill] ${pkg.name}: ${downloads.length} days, ${totalDownloads.toLocaleString()} total downloads`
      );
    } catch (err) {
      console.error(`[npm backfill] Error backfilling ${pkg.name}:`, err);
    }
  }
}
