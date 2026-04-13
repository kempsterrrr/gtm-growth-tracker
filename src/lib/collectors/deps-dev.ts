import { getDb } from "../db/client";
import { trackedPackages, reverseDependencies, reverseDependencyCounts, events } from "../db/schema";
import { getDependents } from "../api-clients/deps-dev-client";
import { sql } from "drizzle-orm";

export async function collectDependencies() {
  const db = getDb();
  const packages = db.select().from(trackedPackages).all();

  if (packages.length === 0) {
    console.log("[deps] No packages to collect");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  for (const pkg of packages) {
    try {
      console.log(`[deps] Collecting dependents for ${pkg.registry}/${pkg.name}...`);
      const result = await getDependents(pkg.registry, pkg.name);

      // Track the count
      db.insert(reverseDependencyCounts)
        .values({
          packageId: pkg.id,
          date: today,
          count: result.count,
        })
        .onConflictDoUpdate({
          target: [reverseDependencyCounts.packageId, reverseDependencyCounts.date],
          set: { count: sql`excluded.count` },
        })
        .run();

      // Insert individual dependents and detect new ones
      for (const dep of result.dependents) {
        const existing = db
          .select()
          .from(reverseDependencies)
          .where(
            sql`${reverseDependencies.packageId} = ${pkg.id} AND ${reverseDependencies.dependentName} = ${dep.name} AND ${reverseDependencies.dependentRegistry} = ${pkg.registry}`
          )
          .get();

        if (!existing) {
          // New dependent detected!
          db.insert(reverseDependencies)
            .values({
              packageId: pkg.id,
              dependentName: dep.name,
              dependentRegistry: pkg.registry,
              dependentVersion: dep.version,
              firstSeen: today,
            })
            .run();

          // Auto-create event for new dependency
          db.insert(events)
            .values({
              date: today,
              title: `${dep.name} now depends on ${pkg.name}`,
              description: `New dependent package detected: ${dep.name} (${dep.version || "latest"})`,
              category: "dependency_added",
              source: "auto",
              packageId: pkg.id,
              metadata: JSON.stringify({
                dependentName: dep.name,
                dependentVersion: dep.version,
              }),
            })
            .run();

          console.log(`[deps] New dependent: ${dep.name} -> ${pkg.name}`);
        }
      }

      console.log(`[deps] ${pkg.registry}/${pkg.name}: ${result.count} dependents total`);
    } catch (err) {
      console.error(`[deps] Error collecting ${pkg.registry}/${pkg.name}:`, err);
    }
  }
}
