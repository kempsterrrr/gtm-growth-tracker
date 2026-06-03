import { syncConfig } from "../../scripts/sync-config";
import { collectGithubMetrics } from "../collectors/github";
import { collectNpmDownloads } from "../collectors/npm";
import { collectPypiDownloads } from "../collectors/pypi";
import { collectDependencies } from "../collectors/deps-dev";
import { collectAutoEvents } from "../collectors/events-auto";
import { collectGithubEngagement } from "../collectors/github-engagement";
import { collectUserEnrichment } from "../collectors/github-user-enrichment";
import { collectCommitEmails } from "../collectors/github-commit-emails";
import { resolveCompanies } from "../collectors/company-resolution";
import { scoreCompanies } from "../collectors/company-scoring";
import { evaluateAlerts } from "../collectors/alerts-evaluator";
import { sendAlertNotifications } from "../collectors/slack-notifier";
import type { PipelineStep } from "./runner";

/** GitHub API steps fail fast (recorded as `failed`, dependents `skipped`)
 *  instead of limping along unauthenticated at 60 requests/hour. */
function requireGithubToken() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set — GitHub collection cannot run");
  }
}

/**
 * The single registry of collection steps. Both the CLI run
 * (src/scripts/collect-all.ts) and the manual trigger
 * (src/app/api/collect/route.ts) execute exactly this definition.
 *
 * config-sync precedes everything; the five metric collectors are independent
 * of each other; the sales-intelligence chain is linear.
 */
export const pipelineSteps: PipelineStep[] = [
  { name: "config-sync", dependsOn: [], run: async () => syncConfig() },

  // Metric collectors — independent of each other
  {
    name: "github",
    dependsOn: ["config-sync"],
    run: async () => {
      requireGithubToken();
      await collectGithubMetrics();
    },
  },
  { name: "npm", dependsOn: ["config-sync"], run: () => collectNpmDownloads() },
  { name: "pypi", dependsOn: ["config-sync"], run: () => collectPypiDownloads() },
  { name: "deps-dev", dependsOn: ["config-sync"], run: () => collectDependencies() },
  {
    name: "events-auto",
    dependsOn: ["config-sync"],
    run: async () => {
      requireGithubToken();
      await collectAutoEvents();
    },
  },

  // Sales-intelligence chain — linear
  {
    name: "github-engagement",
    dependsOn: ["config-sync"],
    run: async () => {
      requireGithubToken();
      await collectGithubEngagement();
    },
  },
  {
    name: "github-user-enrichment",
    dependsOn: ["github-engagement"],
    run: async () => {
      requireGithubToken();
      await collectUserEnrichment(50);
    },
  },
  {
    name: "github-commit-emails",
    dependsOn: ["github-user-enrichment"],
    run: () => collectCommitEmails(),
  },
  {
    name: "company-resolution",
    dependsOn: ["github-commit-emails"],
    run: () => resolveCompanies(),
  },
  { name: "company-scoring", dependsOn: ["company-resolution"], run: () => scoreCompanies() },
  { name: "alerts-evaluator", dependsOn: ["company-scoring"], run: () => evaluateAlerts() },
  { name: "slack-notifier", dependsOn: ["alerts-evaluator"], run: () => sendAlertNotifications() },
];
