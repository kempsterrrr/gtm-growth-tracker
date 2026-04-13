import { runMigrations } from "../lib/db/migrate";
import { collectNpmDownloads } from "../lib/collectors/npm";
import { collectGithubMetrics } from "../lib/collectors/github";
import { collectPypiDownloads } from "../lib/collectors/pypi";
import { collectDependencies } from "../lib/collectors/deps-dev";
import { collectAutoEvents } from "../lib/collectors/events-auto";
import { collectGithubEngagement } from "../lib/collectors/github-engagement";
import { collectUserEnrichment } from "../lib/collectors/github-user-enrichment";
import { collectCommitEmails } from "../lib/collectors/github-commit-emails";
import { resolveCompanies } from "../lib/collectors/company-resolution";
import { scoreCompanies } from "../lib/collectors/company-scoring";
import { evaluateAlerts } from "../lib/collectors/alerts-evaluator";
import { sendAlertNotifications } from "../lib/collectors/slack-notifier";
import { syncConfig } from "./sync-config";

async function main() {
  console.log(`[${new Date().toISOString()}] Starting collection run...`);

  // Ensure DB is set up
  runMigrations();

  // Sync config to DB
  syncConfig();

  // Run metric collectors
  await collectGithubMetrics();
  await collectNpmDownloads();
  await collectPypiDownloads();
  await collectDependencies();
  await collectAutoEvents();

  // Sales intelligence pipeline
  await collectGithubEngagement();
  await collectUserEnrichment(50);
  await collectCommitEmails();
  await resolveCompanies();
  await scoreCompanies();
  await evaluateAlerts();
  await sendAlertNotifications();

  console.log(`[${new Date().toISOString()}] Collection complete.`);
}

main().catch((err) => {
  console.error("Collection failed:", err);
  process.exit(1);
});
