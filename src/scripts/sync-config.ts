import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { getDb } from "../lib/db/client";
import { trackedRepos, trackedPackages } from "../lib/db/schema";
import { sql } from "drizzle-orm";
import type { GtmConfig } from "../lib/types/config";

export function syncConfig() {
  const configPath = path.join(process.cwd(), "gtm-config.yaml");
  if (!fs.existsSync(configPath)) {
    console.log("[sync-config] No gtm-config.yaml found, skipping");
    return;
  }

  const config: GtmConfig = parse(fs.readFileSync(configPath, "utf-8"));
  const db = getDb();

  // Sync repos
  if (config.github?.repos) {
    for (const repo of config.github.repos) {
      db.insert(trackedRepos)
        .values({
          owner: repo.owner,
          name: repo.name,
          displayName: repo.display_name || null,
        })
        .onConflictDoUpdate({
          target: [trackedRepos.owner, trackedRepos.name],
          set: { displayName: sql`excluded.display_name` },
        })
        .run();
      console.log(`[sync-config] Synced repo: ${repo.owner}/${repo.name}`);
    }
  }

  // Sync npm packages
  if (config.packages?.npm) {
    for (const pkg of config.packages.npm) {
      let repoId: number | null = null;
      if (pkg.github_repo) {
        const [owner, name] = pkg.github_repo.split("/");
        const repo = db
          .select()
          .from(trackedRepos)
          .where(sql`${trackedRepos.owner} = ${owner} AND ${trackedRepos.name} = ${name}`)
          .get();
        if (repo) repoId = repo.id;
      }

      db.insert(trackedPackages)
        .values({
          registry: "npm",
          name: pkg.name,
          displayName: pkg.display_name || null,
          repoId,
        })
        .onConflictDoUpdate({
          target: [trackedPackages.registry, trackedPackages.name],
          set: {
            displayName: sql`excluded.display_name`,
            repoId: repoId ? sql`${repoId}` : sql`repo_id`,
          },
        })
        .run();
      console.log(`[sync-config] Synced npm package: ${pkg.name}`);
    }
  }

  // Sync pypi packages
  if (config.packages?.pypi) {
    for (const pkg of config.packages.pypi) {
      let repoId: number | null = null;
      if (pkg.github_repo) {
        const [owner, name] = pkg.github_repo.split("/");
        const repo = db
          .select()
          .from(trackedRepos)
          .where(sql`${trackedRepos.owner} = ${owner} AND ${trackedRepos.name} = ${name}`)
          .get();
        if (repo) repoId = repo.id;
      }

      db.insert(trackedPackages)
        .values({
          registry: "pypi",
          name: pkg.name,
          displayName: pkg.display_name || null,
          repoId,
        })
        .onConflictDoUpdate({
          target: [trackedPackages.registry, trackedPackages.name],
          set: {
            displayName: sql`excluded.display_name`,
            repoId: repoId ? sql`${repoId}` : sql`repo_id`,
          },
        })
        .run();
      console.log(`[sync-config] Synced pypi package: ${pkg.name}`);
    }
  }

  console.log("[sync-config] Config sync complete.");
}
