import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { pipelineRuns, pipelineRunSteps } from "../db/schema";

export interface PipelineStep {
  name: string;
  dependsOn: string[];
  run: () => Promise<void>;
}

export type StepStatus = "success" | "failed" | "skipped";

export interface StepResult {
  name: string;
  status: StepStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface RunSummary {
  runId: number;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  steps: StepResult[];
}

/**
 * Validates a pipeline definition (unique names, resolvable dependencies, no
 * cycles) and returns the steps in a dependency-respecting execution order.
 * Registration order is preserved among steps whose dependencies are met.
 */
export function validatePipeline(steps: PipelineStep[]): PipelineStep[] {
  const names = new Set<string>();
  for (const step of steps) {
    if (names.has(step.name)) {
      throw new Error(`Duplicate pipeline step name: "${step.name}"`);
    }
    names.add(step.name);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!names.has(dep)) {
        throw new Error(`Step "${step.name}" depends on unknown step "${dep}"`);
      }
    }
  }

  const ordered: PipelineStep[] = [];
  const placed = new Set<string>();
  let remaining = steps;
  while (remaining.length > 0) {
    const ready = remaining.filter((s) => s.dependsOn.every((d) => placed.has(d)));
    if (ready.length === 0) {
      throw new Error(
        `Dependency cycle in pipeline involving: ${remaining.map((s) => s.name).join(", ")}`
      );
    }
    for (const step of ready) {
      ordered.push(step);
      placed.add(step.name);
    }
    remaining = remaining.filter((s) => !placed.has(s.name));
  }
  return ordered;
}

/**
 * Runs the steps sequentially in dependency order. A step that throws is
 * recorded as `failed`; its transitive dependents are recorded as `skipped`
 * (never silently dropped); independent steps still run. Every step's outcome
 * is persisted to pipeline_runs / pipeline_run_steps.
 */
export async function runPipeline(steps: PipelineStep[]): Promise<RunSummary> {
  const ordered = validatePipeline(steps);
  const db = getDb();
  const startedAt = new Date().toISOString();
  const run = db.insert(pipelineRuns).values({ status: "running", startedAt }).returning().get();

  const results = new Map<string, StepResult>();

  for (const step of ordered) {
    const blockedBy = step.dependsOn.find((d) => results.get(d)?.status !== "success");
    const stepStartedAt = new Date().toISOString();
    const t0 = Date.now();
    let result: StepResult;

    if (blockedBy) {
      const reason = `skipped because dependency "${blockedBy}" ${results.get(blockedBy)!.status}`;
      console.warn(`[pipeline] ${step.name}: ${reason}`);
      result = {
        name: step.name,
        status: "skipped",
        error: reason,
        startedAt: stepStartedAt,
        finishedAt: stepStartedAt,
        durationMs: 0,
      };
    } else {
      console.log(`[pipeline] ${step.name}: starting`);
      try {
        await step.run();
        result = {
          name: step.name,
          status: "success",
          error: null,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
        };
        console.log(`[pipeline] ${step.name}: success (${result.durationMs}ms)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = {
          name: step.name,
          status: "failed",
          error: message,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
        };
        console.error(`[pipeline] ${step.name}: FAILED (${result.durationMs}ms) — ${message}`);
      }
    }

    results.set(step.name, result);
    db.insert(pipelineRunSteps)
      .values({
        runId: run.id,
        stepName: step.name,
        status: result.status,
        error: result.error,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      })
      .run();
  }

  const finishedAt = new Date().toISOString();
  const stepResults = ordered.map((s) => results.get(s.name)!);
  const status = stepResults.some((r) => r.status === "failed") ? "failed" : "success";
  db.update(pipelineRuns)
    .set({ status, finishedAt })
    .where(sql`${pipelineRuns.id} = ${run.id}`)
    .run();

  const counts = {
    success: stepResults.filter((r) => r.status === "success").length,
    failed: stepResults.filter((r) => r.status === "failed").length,
    skipped: stepResults.filter((r) => r.status === "skipped").length,
  };
  console.log(
    `[pipeline] Run ${run.id} ${status}: ${counts.success} succeeded, ${counts.failed} failed, ${counts.skipped} skipped`
  );

  return { runId: run.id, status, startedAt, finishedAt, steps: stepResults };
}
