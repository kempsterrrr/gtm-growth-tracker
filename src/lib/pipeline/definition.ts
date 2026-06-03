import { syncToDatabase } from "../config/gtm-config";
import { seedDefaults } from "../db/seed-defaults";
import { collectGithubMetrics } from "../collectors/github";
import { collectNpmDownloads } from "../collectors/npm";
import { collectPypiDownloads } from "../collectors/pypi";
import { collectDependencies } from "../collectors/deps-dev";
import { collectAutoEvents } from "../collectors/events-auto";
import { collectGithubEngagement } from "../collectors/github-engagement";
import { collectUserEnrichment } from "../collectors/github-user-enrichment";
import { collectCommitEmails } from "../collectors/github-commit-emails";
import { resolveCompanies } from "../collectors/company-resolution";
import { resolveCompetitorDependents } from "../collectors/competitor-dependents";
import { scoreCompanies } from "../collectors/company-scoring";
import { evaluateAlerts } from "../collectors/alerts-evaluator";
import { sendAlertNotifications } from "../collectors/slack-notifier";
import type { PipelineStep } from "./runner";

/**
 * The single registry of collection steps. Both the CLI run
 * (src/scripts/collect-all.ts) and the manual trigger
 * (src/app/api/collect/route.ts) execute exactly this definition.
 *
 * config-sync precedes everything; the five metric collectors are independent
 * of each other; the sales-intelligence chain is linear.
 */
export const pipelineSteps: PipelineStep[] = [
  { name: "config-sync", dependsOn: [], run: async () => syncToDatabase() },
  // Data seeding (formerly migration DDL) — default alert rules
  { name: "seed-defaults", dependsOn: ["config-sync"], run: async () => seedDefaults() },

  // Metric collectors — independent of each other. GitHub steps fail fast with
  // a typed GithubAuthError from createGithubClient() when GITHUB_TOKEN is unset.
  { name: "github", dependsOn: ["config-sync"], run: () => collectGithubMetrics() },
  { name: "npm", dependsOn: ["config-sync"], run: () => collectNpmDownloads() },
  { name: "pypi", dependsOn: ["config-sync"], run: () => collectPypiDownloads() },
  { name: "deps-dev", dependsOn: ["config-sync"], run: () => collectDependencies() },
  { name: "events-auto", dependsOn: ["config-sync"], run: () => collectAutoEvents() },

  // Sales-intelligence chain — linear
  { name: "github-engagement", dependsOn: ["config-sync"], run: () => collectGithubEngagement() },
  {
    name: "github-user-enrichment",
    dependsOn: ["github-engagement"],
    run: () => collectUserEnrichment(50),
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
  {
    // The depends-on-competitor signal: reads reverse_dependencies persisted
    // by prior deps-dev runs (no hard edge on deps-dev — a flaky deps.dev day
    // must not skip the scoring chain; new dependents lag at most one run).
    name: "resolve-competitor-dependents",
    dependsOn: ["config-sync"],
    run: () => resolveCompetitorDependents(),
  },
  {
    name: "company-scoring",
    dependsOn: ["company-resolution", "resolve-competitor-dependents"],
    run: () => scoreCompanies(),
  },
  {
    name: "alerts-evaluator",
    dependsOn: ["company-scoring", "seed-defaults"],
    run: () => evaluateAlerts(),
  },
  { name: "slack-notifier", dependsOn: ["alerts-evaluator"], run: () => sendAlertNotifications() },
];
