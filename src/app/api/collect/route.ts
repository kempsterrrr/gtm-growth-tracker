import { NextResponse } from "next/server";
import { runMigrations } from "@/lib/db/migrate";
import { runPipeline } from "@/lib/pipeline/runner";
import { pipelineSteps } from "@/lib/pipeline/definition";

export async function POST() {
  try {
    runMigrations();

    const summary = await runPipeline(pipelineSteps);

    // Settings page renders `results` as plain strings
    const results = summary.steps.map((s) => {
      const detail = s.error ? ` — ${s.error}` : ` (${s.durationMs}ms)`;
      return `${s.name}: ${s.status}${detail}`;
    });

    return NextResponse.json({
      success: summary.status === "success",
      timestamp: summary.finishedAt,
      runId: summary.runId,
      status: summary.status,
      steps: summary.steps,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
