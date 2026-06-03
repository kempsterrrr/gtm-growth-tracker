import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { PipelineStep } from "./runner";

// DATABASE_PATH must be set before the db modules are loaded — they read it at import time.
process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "gtm-pipeline-test-")), "test.db");

const { runMigrations } = await import("../db/migrate");
const { runPipeline, validatePipeline } = await import("./runner");

runMigrations();

const ok = (name: string, dependsOn: string[] = []): PipelineStep => ({
  name,
  dependsOn,
  run: async () => {},
});

const failing = (name: string, dependsOn: string[] = []): PipelineStep => ({
  name,
  dependsOn,
  run: async () => {
    throw new Error(`${name} exploded`);
  },
});

describe("runPipeline", () => {
  it("still runs an independent step when a sibling throws", async () => {
    const ran: string[] = [];
    const summary = await runPipeline([
      failing("a"),
      {
        name: "b",
        dependsOn: [],
        run: async () => {
          ran.push("b");
        },
      },
    ]);
    expect(ran).toEqual(["b"]);
    expect(summary.steps.find((s) => s.name === "a")?.status).toBe("failed");
    expect(summary.steps.find((s) => s.name === "b")?.status).toBe("success");
  });

  it("marks transitive dependents of a failed step as skipped with a recorded reason", async () => {
    const summary = await runPipeline([failing("a"), ok("b", ["a"]), ok("c", ["b"]), ok("d")]);
    const byName = Object.fromEntries(summary.steps.map((s) => [s.name, s]));
    expect(byName.b.status).toBe("skipped");
    expect(byName.c.status).toBe("skipped");
    expect(byName.d.status).toBe("success");
    expect(byName.b.error).toContain('"a"');
  });

  it("lists every registered step in the summary with a status", async () => {
    const summary = await runPipeline([ok("a"), failing("b"), ok("c", ["b"])]);
    expect(summary.steps.map((s) => s.name).sort()).toEqual(["a", "b", "c"]);
    for (const step of summary.steps) {
      expect(["success", "failed", "skipped"]).toContain(step.status);
    }
  });

  it("records the failed step's error message", async () => {
    const summary = await runPipeline([failing("boom")]);
    expect(summary.steps[0].error).toContain("boom exploded");
  });

  it("signals the run as failed when any step fails, success otherwise", async () => {
    const failed = await runPipeline([ok("a"), failing("b")]);
    expect(failed.status).toBe("failed");
    const succeeded = await runPipeline([ok("a"), ok("b", ["a"])]);
    expect(succeeded.status).toBe("success");
  });

  it("persists a run row and one step row per registered step", async () => {
    const summary = await runPipeline([ok("a"), failing("b"), ok("c", ["b"])]);
    const sqlite = new Database(process.env.DATABASE_PATH!);
    const run = sqlite
      .prepare("SELECT * FROM pipeline_runs WHERE id = ?")
      .get(summary.runId) as Record<string, unknown>;
    const steps = sqlite
      .prepare("SELECT * FROM pipeline_run_steps WHERE run_id = ? ORDER BY id")
      .all(summary.runId) as Record<string, unknown>[];
    sqlite.close();

    expect(run.status).toBe("failed");
    expect(run.started_at).toBeTruthy();
    expect(run.finished_at).toBeTruthy();
    expect(steps.map((s) => [s.step_name, s.status])).toEqual([
      ["a", "success"],
      ["b", "failed"],
      ["c", "skipped"],
    ]);
    expect(String(steps.find((s) => s.step_name === "b")!.error)).toContain("b exploded");
  });

  it("executes steps in dependency order regardless of registration order", async () => {
    const order: string[] = [];
    const track = (name: string, dependsOn: string[] = []): PipelineStep => ({
      name,
      dependsOn,
      run: async () => {
        order.push(name);
      },
    });
    await runPipeline([track("late", ["early"]), track("early")]);
    expect(order).toEqual(["early", "late"]);
  });
});

describe("validatePipeline", () => {
  it("throws on duplicate step names", () => {
    expect(() => validatePipeline([ok("a"), ok("a")])).toThrow(/duplicate/i);
  });

  it("throws on unknown dependencies", () => {
    expect(() => validatePipeline([ok("a", ["ghost"])])).toThrow(/unknown/i);
  });

  it("throws on dependency cycles", () => {
    expect(() => validatePipeline([ok("a", ["b"]), ok("b", ["a"])])).toThrow(/cycle/i);
  });

  it("returns steps in dependency order", () => {
    const sorted = validatePipeline([ok("b", ["a"]), ok("a")]);
    expect(sorted.map((s) => s.name)).toEqual(["a", "b"]);
  });
});
