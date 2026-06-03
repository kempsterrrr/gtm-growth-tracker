import { runMigrations } from "../lib/db/migrate";
import { backfillNpmDownloads } from "../lib/collectors/npm";
import { readConfig, syncToDatabase, ConfigError } from "../lib/config/gtm-config";

async function main() {
  console.log("Setting up database...");
  runMigrations();
  syncToDatabase();

  // Read config for backfill date
  let fromDate = "2024-01-01"; // Default
  try {
    const config = readConfig();
    if (config.collection?.npm_backfill_from) {
      fromDate = config.collection.npm_backfill_from;
    }
  } catch (err) {
    if (!(err instanceof ConfigError && err.message.includes("not found"))) throw err;
    // Missing config file: fall back to the default date
  }

  console.log(`Backfilling npm downloads from ${fromDate}...`);
  await backfillNpmDownloads(fromDate);

  console.log("Backfill complete!");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
