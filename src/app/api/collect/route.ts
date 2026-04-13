import { NextResponse } from "next/server";
import { runMigrations } from "@/lib/db/migrate";
import { collectNpmDownloads } from "@/lib/collectors/npm";
import { collectGithubMetrics } from "@/lib/collectors/github";
import { collectPypiDownloads } from "@/lib/collectors/pypi";
import { collectDependencies } from "@/lib/collectors/deps-dev";
import { collectAutoEvents } from "@/lib/collectors/events-auto";
import { collectGithubEngagement } from "@/lib/collectors/github-engagement";
import { collectUserEnrichment } from "@/lib/collectors/github-user-enrichment";
import { collectCommitEmails } from "@/lib/collectors/github-commit-emails";
import { resolveCompanies } from "@/lib/collectors/company-resolution";
import { scoreCompanies } from "@/lib/collectors/company-scoring";
import { evaluateAlerts } from "@/lib/collectors/alerts-evaluator";
import { sendAlertNotifications } from "@/lib/collectors/slack-notifier";

export async function POST() {
  try {
    runMigrations();

    const results: string[] = [];

    const collectors = [
      { name: "GitHub metrics", fn: collectGithubMetrics },
      { name: "npm downloads", fn: collectNpmDownloads },
      { name: "PyPI downloads", fn: collectPypiDownloads },
      { name: "Dependencies", fn: collectDependencies },
      { name: "Auto events", fn: collectAutoEvents },
      { name: "GitHub engagement", fn: collectGithubEngagement },
      { name: "User enrichment", fn: () => collectUserEnrichment(50) },
      { name: "Commit emails", fn: collectCommitEmails },
      { name: "Company resolution", fn: resolveCompanies },
      { name: "Company scoring", fn: scoreCompanies },
      { name: "Alert evaluation", fn: evaluateAlerts },
      { name: "Slack notifications", fn: sendAlertNotifications },
    ];

    for (const c of collectors) {
      try {
        await c.fn();
        results.push(`${c.name}: OK`);
      } catch (err) {
        results.push(`${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
