import { getDb } from "../db/client";
import { trackedPackages, pypiDownloads } from "../db/schema";
import { getPypiOverallDownloads } from "../api-clients/pypi-client";
import { eq, sql } from "drizzle-orm";

export async function collectPypiDownloads() {
  const db = getDb();
  const packages = db
    .select()
    .from(trackedPackages)
    .where(eq(trackedPackages.registry, "pypi"))
    .all();

  if (packages.length === 0) {
    console.log("[pypi] No packages to collect");
    return;
  }

  for (const pkg of packages) {
    try {
      console.log(`[pypi] Collecting ${pkg.name}...`);
      const data = await getPypiOverallDownloads(pkg.name);

      let insertCount = 0;
      for (const record of data.data) {
        db.insert(pypiDownloads)
          .values({
            packageId: pkg.id,
            date: record.date,
            downloads: record.downloads,
            category: "overall",
            categoryValue: record.category,
          })
          .onConflictDoUpdate({
            target: [
              pypiDownloads.packageId,
              pypiDownloads.date,
              pypiDownloads.category,
              pypiDownloads.categoryValue,
            ],
            set: { downloads: sql`excluded.downloads` },
          })
          .run();
        insertCount++;
      }

      console.log(`[pypi] ${pkg.name}: ${insertCount} records archived`);
    } catch (err) {
      console.error(`[pypi] Error collecting ${pkg.name}:`, err);
    }
  }
}
