import { runMigrations } from "../lib/db/migrate";
import { runPipeline } from "../lib/pipeline/runner";
import { pipelineSteps } from "../lib/pipeline/definition";

async function main() {
  console.log(`[${new Date().toISOString()}] Starting collection run...`);

  // Ensure DB is set up (includes the pipeline run-record tables)
  runMigrations();

  const summary = await runPipeline(pipelineSteps);

  console.log(`\nRun ${summary.runId} summary:`);
  for (const step of summary.steps) {
    const detail = step.error ? ` — ${step.error}` : "";
    console.log(`  ${step.status.toUpperCase().padEnd(7)} ${step.name} (${step.durationMs}ms)${detail}`);
  }
  console.log(`[${new Date().toISOString()}] Collection ${summary.status}.`);

  // The daily GitHub Action should show red when any step failed
  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Collection failed:", err);
  process.exit(1);
});
