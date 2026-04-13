import { runMigrations } from "../lib/db/migrate";
import { collectNpmDownloads } from "../lib/collectors/npm";
import { collectGithubMetrics } from "../lib/collectors/github";
import { collectPypiDownloads } from "../lib/collectors/pypi";
import { collectDependencies } from "../lib/collectors/deps-dev";
import { collectAutoEvents } from "../lib/collectors/events-auto";
import { syncConfig } from "./sync-config";

async function main() {
  console.log(`[${new Date().toISOString()}] Starting collection run...`);

  // Ensure DB is set up
  runMigrations();

  // Sync config to DB
  syncConfig();

  // Run all collectors
  await collectGithubMetrics();
  await collectNpmDownloads();
  await collectPypiDownloads();
  await collectDependencies();
  await collectAutoEvents();

  console.log(`[${new Date().toISOString()}] Collection complete.`);
}

main().catch((err) => {
  console.error("Collection failed:", err);
  process.exit(1);
});
