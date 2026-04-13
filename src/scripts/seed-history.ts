import { runMigrations } from "../lib/db/migrate";
import { backfillNpmDownloads } from "../lib/collectors/npm";
import { syncConfig } from "./sync-config";
import fs from "fs";
import { parse } from "yaml";
import path from "path";
import type { GtmConfig } from "../lib/types/config";

async function main() {
  console.log("Setting up database...");
  runMigrations();
  syncConfig();

  // Read config for backfill date
  const configPath = path.join(process.cwd(), "gtm-config.yaml");
  let fromDate = "2024-01-01"; // Default

  if (fs.existsSync(configPath)) {
    const config: GtmConfig = parse(fs.readFileSync(configPath, "utf-8"));
    if (config.collection?.npm_backfill_from) {
      fromDate = config.collection.npm_backfill_from;
    }
  }

  console.log(`Backfilling npm downloads from ${fromDate}...`);
  await backfillNpmDownloads(fromDate);

  console.log("Backfill complete!");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
