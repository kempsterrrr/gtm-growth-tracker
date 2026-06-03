# Pipeline Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 12-await collection run with one `runPipeline` orchestrator module that owns the step registry, dependency ordering, per-step failure isolation, and a persisted run record — plus establish the Vitest test foundation (GitHub issue #5).

**Architecture:** A new `src/lib/pipeline/` module: `runner.ts` exposes `runPipeline(steps)` (topological execution, failed steps mark transitive dependents `skipped`, run record persisted to two new SQLite tables) and `definition.ts` registers config-sync + the 12 collectors with their dependencies. `src/scripts/collect-all.ts` and `src/app/api/collect/route.ts` become thin adapters over the shared definition. Tests use the existing `DATABASE_PATH` env seam pointed at a temp file with real SQLite (no mocks).

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (synchronous), Drizzle ORM, Next.js 16 App Router.

**Key constraints from the PRD (issue #5):**
- Collectors keep their exported-async-function interfaces — wrap, don't rewrite.
- Schema added to BOTH `src/lib/db/schema.ts` and `src/lib/db/migrate.ts` (repo convention).
- No retries/backoff/parallelism. No run-history UI.
- The settings page reads `data.results` (string[]) from POST `/api/collect` — keep that field.
- The working tree has pre-existing uncommitted changes (`gtm-config.yaml`, `package-lock.json`, `src/app/api/config/route.ts`, `src/app/settings/page.tsx`, `src/lib/validation/`, `CLAUDE.md` untracked). Stage only files this plan touches; never `git add -A`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `vitest.config.ts` | Create | Vitest config: node env, forks pool (native better-sqlite3), `@/` alias |
| `package.json` | Modify | Add `vitest` devDependency, `"test": "vitest run"` script |
| `src/lib/db/schema.ts` | Modify | Add `pipelineRuns`, `pipelineRunSteps` Drizzle tables |
| `src/lib/db/migrate.ts` | Modify | Add matching raw-SQL `CREATE TABLE IF NOT EXISTS` |
| `src/lib/pipeline/runner.ts` | Create | `runPipeline`, `validatePipeline`, types — ALL failure policy lives here |
| `src/lib/pipeline/runner.test.ts` | Create | Thorough runner tests via fake steps + persisted-record assertions |
| `src/lib/pipeline/definition.ts` | Create | The single 13-step registry (config-sync + 12 collectors) |
| `src/lib/pipeline/definition.test.ts` | Create | Shape-only tests: unique names, resolvable deps, no cycles |
| `src/scripts/collect-all.ts` | Rewrite | Thin CLI adapter; exit 1 if any step failed |
| `src/app/api/collect/route.ts` | Rewrite | Thin API adapter; same pipeline definition; keeps `results` field |
| `src/lib/collectors/github-engagement.ts` | Modify | 5× `catch { break; }` → log the error |
| `src/lib/collectors/github-user-enrichment.ts` | Modify | comment-only catch → log the error |
| `src/lib/collectors/company-resolution.ts` | Modify | `catch { continue; }` → log the error |
| `src/lib/collectors/github-commit-emails.ts` | Modify | `catch { continue; }` → log the error |
| `src/lib/collectors/github.ts` | Modify | 3 warns gain the swallowed error object |
| `CLAUDE.md` | Modify | Add `npm test`; describe pipeline module |

---

### Task 1: Vitest foundation

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script**

In `package.json` scripts, after `"collect"`:

```json
    "collect": "tsx src/scripts/collect-all.ts",
    "test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // better-sqlite3 is a native addon; forks avoid worker-thread segfaults
    pool: "forks",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 4: Verify the runner boots**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0, "No test files found" notice.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add Vitest foundation with npm test script"
```

(Note: `package-lock.json` had pre-existing modifications; inspect `git diff package-lock.json` — if the pre-existing diff is just lockfile sync for already-committed deps, committing it together is fine.)

---

### Task 2: Run-record tables (both schema files)

**Files:**
- Modify: `src/lib/db/schema.ts` (append at end)
- Modify: `src/lib/db/migrate.ts` (inside the `sqlite.exec` template, before the `-- Seed default alert rules` comment)

- [ ] **Step 1: Append Drizzle tables to `src/lib/db/schema.ts`**

```ts
export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

export const pipelineRunSteps = sqliteTable(
  "pipeline_run_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    stepName: text("step_name").notNull(),
    status: text("status", { enum: ["success", "failed", "skipped"] }).notNull(),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
  },
  (table) => [uniqueIndex("pipeline_run_steps_run_step").on(table.runId, table.stepName)]
);
```

- [ ] **Step 2: Add matching raw SQL to `src/lib/db/migrate.ts`**

Insert before the `-- Seed default alert rules` block:

```sql
    -- Pipeline run records

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES pipeline_runs(id),
      step_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'skipped')),
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      UNIQUE(run_id, step_name)
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_run_steps_run ON pipeline_run_steps(run_id);
```

- [ ] **Step 3: Verify migration runs and creates the tables**

```bash
DATABASE_PATH=$(mktemp -d)/check.db npm run db:migrate
```
Expected: "Migrations complete." (Idempotency: tables are IF NOT EXISTS, also safe on the committed prod DB.)

```bash
TMPDB=$(mktemp -d)/check.db && DATABASE_PATH=$TMPDB npm run db:migrate && sqlite3 $TMPDB ".tables" | tr ' ' '\n' | grep pipeline
```
Expected output includes `pipeline_runs` and `pipeline_run_steps`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.ts
git commit -m "feat: add pipeline_runs and pipeline_run_steps tables"
```

---

### Task 3: `runPipeline` runner (TDD)

**Files:**
- Create: `src/lib/pipeline/runner.test.ts`
- Create: `src/lib/pipeline/runner.ts`

- [ ] **Step 1: Write the failing tests — `src/lib/pipeline/runner.test.ts`**

```ts
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
      { name: "b", dependsOn: [], run: async () => { ran.push("b"); } },
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
      run: async () => { order.push(name); },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./runner`.

- [ ] **Step 3: Implement `src/lib/pipeline/runner.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all runner tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/runner.ts src/lib/pipeline/runner.test.ts
git commit -m "feat: add runPipeline orchestrator with failure isolation and run records"
```

---

### Task 4: Pipeline definition (TDD, shape tests only)

**Files:**
- Create: `src/lib/pipeline/definition.test.ts`
- Create: `src/lib/pipeline/definition.ts`

- [ ] **Step 1: Write the failing tests — `src/lib/pipeline/definition.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "gtm-definition-test-")), "test.db");

const { pipelineSteps } = await import("./definition");
const { validatePipeline } = await import("./runner");

describe("pipelineSteps", () => {
  it("registers 13 uniquely-named steps (config-sync + 12 collectors)", () => {
    expect(pipelineSteps).toHaveLength(13);
    expect(new Set(pipelineSteps.map((s) => s.name)).size).toBe(13);
  });

  it("registers the expected step names", () => {
    expect(pipelineSteps.map((s) => s.name).sort()).toEqual(
      [
        "config-sync",
        "github",
        "npm",
        "pypi",
        "deps-dev",
        "events-auto",
        "github-engagement",
        "github-user-enrichment",
        "github-commit-emails",
        "company-resolution",
        "company-scoring",
        "alerts-evaluator",
        "slack-notifier",
      ].sort()
    );
  });

  it("has resolvable, acyclic dependencies", () => {
    expect(() => validatePipeline(pipelineSteps)).not.toThrow();
  });

  it("makes every collector transitively depend on config-sync", () => {
    const byName = new Map(pipelineSteps.map((s) => [s.name, s]));
    for (const step of pipelineSteps) {
      if (step.name === "config-sync") continue;
      const reachable = new Set<string>();
      const stack = [...step.dependsOn];
      while (stack.length > 0) {
        const dep = stack.pop()!;
        if (reachable.has(dep)) continue;
        reachable.add(dep);
        stack.push(...(byName.get(dep)?.dependsOn ?? []));
      }
      expect(reachable.has("config-sync"), `${step.name} should depend on config-sync`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: definition tests FAIL — cannot resolve `./definition`. Runner tests still pass.

- [ ] **Step 3: Implement `src/lib/pipeline/definition.ts`**

```ts
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
  { name: "github-commit-emails", dependsOn: ["github-user-enrichment"], run: () => collectCommitEmails() },
  { name: "company-resolution", dependsOn: ["github-commit-emails"], run: () => resolveCompanies() },
  { name: "company-scoring", dependsOn: ["company-resolution"], run: () => scoreCompanies() },
  { name: "alerts-evaluator", dependsOn: ["company-scoring"], run: () => evaluateAlerts() },
  { name: "slack-notifier", dependsOn: ["alerts-evaluator"], run: () => sendAlertNotifications() },
];
```

(If any collector's return type is not `Promise<void>`, wrap as `run: async () => { await fn(); }` — same pattern as the github steps.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (runner + definition).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/definition.ts src/lib/pipeline/definition.test.ts
git commit -m "feat: register all 13 collection steps in one pipeline definition"
```

---

### Task 5: CLI adapter

**Files:**
- Rewrite: `src/scripts/collect-all.ts`

- [ ] **Step 1: Replace `src/scripts/collect-all.ts` entirely**

```ts
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
```

- [ ] **Step 2: Verify no direct collector imports remain (AC #3)**

Run: `grep -n "lib/collectors" src/scripts/collect-all.ts`
Expected: no output (exit 1).

- [ ] **Step 3: Commit**

```bash
git add src/scripts/collect-all.ts
git commit -m "refactor: collect-all CLI is a thin adapter over the pipeline"
```

---

### Task 6: API route adapter

**Files:**
- Rewrite: `src/app/api/collect/route.ts`

- [ ] **Step 1: Replace `src/app/api/collect/route.ts` entirely**

The settings page (`src/app/settings/page.tsx:112`) renders `data.results` as a string array — keep that field.

```ts
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
```

- [ ] **Step 2: Verify no direct collector imports remain (AC #3)**

Run: `grep -n "lib/collectors" src/app/api/collect/route.ts`
Expected: no output (exit 1).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/collect/route.ts
git commit -m "refactor: collect API route runs the shared pipeline definition"
```

---

### Task 7: Log swallowed errors in collector catch blocks (AC #4)

**Files:**
- Modify: `src/lib/collectors/github-engagement.ts` (5 blocks: ~lines 100, 117, 135, 153, 172)
- Modify: `src/lib/collectors/github-user-enrichment.ts` (~line 95)
- Modify: `src/lib/collectors/company-resolution.ts` (~line 113)
- Modify: `src/lib/collectors/github-commit-emails.ts` (~line 28)
- Modify: `src/lib/collectors/github.ts` (~lines 29, 83, 108)

No behavioural change beyond logging — control flow (`break`/`continue`) is preserved.

- [ ] **Step 1: `github-engagement.ts` — five `} catch { break; }` blocks**

Each loop (stars, forks, issues, PRs, commits) ends with `} catch { break; }`. Replace each with an endpoint-specific log (the `page`, `owner`, `name` variables are in scope in all five):

Stars block:
```ts
      } catch (err) {
        console.warn(`[engagement] ${owner}/${name}: stargazers page ${page} failed, stopping:`, err);
        break;
      }
```
Forks block: same shape with `forks page ${page}`.
Issues block: `issues page ${page}`.
PRs block: `PRs page ${page}`.
Commits block: `commits page ${page}`.

- [ ] **Step 2: `github-user-enrichment.ts` — comment-only orgs catch**

```ts
      } catch {
        // Orgs may fail for some users, continue
      }
```
→
```ts
      } catch (err) {
        // Orgs may fail for some users, continue
        console.warn(`[enrichment] Could not fetch orgs for ${item.userLogin}:`, err);
      }
```

- [ ] **Step 3: `company-resolution.ts` — URL-parse catch**

```ts
      } catch {
        continue;
      }
```
→
```ts
      } catch (err) {
        console.warn(`[company-resolution] Skipping invalid org website "${org.orgWebsite}":`, err);
        continue;
      }
```

- [ ] **Step 4: `github-commit-emails.ts` — metadata-parse catch**

```ts
    } catch {
      continue;
    }
```
→
```ts
    } catch (err) {
      console.warn(`[commit-emails] Skipping unparseable commit metadata for user ${event.userId}:`, err);
      continue;
    }
```

- [ ] **Step 5: `github.ts` — three warns gain the swallowed error**

Line ~29: `console.warn(\`[github] Could not fetch contributors for ${repo.owner}/${repo.name}\`);` →
```ts
      } catch (err) {
        console.warn(`[github] Could not fetch contributors for ${repo.owner}/${repo.name}:`, err);
      }
```
Line ~83 (clones) and ~108 (views): same pattern — `catch` → `catch (err)`, append `:`, `err` to the existing warn message.

- [ ] **Step 6: Verify no silent catch remains (AC #4 grep)**

Run: `grep -rn "catch {" src/lib/collectors/`
Expected: no output (every catch now binds and logs the error).

Run: `npm test`
Expected: PASS (no behaviour change).

- [ ] **Step 7: Commit**

```bash
git add src/lib/collectors/github-engagement.ts src/lib/collectors/github-user-enrichment.ts src/lib/collectors/company-resolution.ts src/lib/collectors/github-commit-emails.ts src/lib/collectors/github.ts
git commit -m "fix: log previously swallowed errors in collector catch blocks"
```

---

### Task 8: CLAUDE.md + final verification of all acceptance criteria

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

In the Commands block, after `npm run collect`:
```
npm test             # Vitest (pipeline tests; no live tokens needed)
```
Remove the "There is no test suite." sentence (replace with "Tests use Vitest against a temp SQLite file via `DATABASE_PATH`; no live tokens needed.").

Rewrite architecture point 1 to describe the pipeline module:

```markdown
1. **Collection pipeline** (`src/scripts/collect-all.ts`, run via `npm run collect` or the daily GitHub Action): a thin adapter over `src/lib/pipeline/` — `definition.ts` is the **single registry** of all 13 steps (config-sync, the five independent metric collectors `github`/`npm`/`pypi`/`deps-dev`/`events-auto`, and the linear sales-intelligence chain `github-engagement` → `github-user-enrichment` → `github-commit-emails` → `company-resolution` → `company-scoring` → `alerts-evaluator` → `slack-notifier`), and `runner.ts` (`runPipeline`) owns dependency ordering, per-step failure isolation (a failed step marks transitive dependents `skipped`; independent steps still run), and persists a run record to `pipeline_runs`/`pipeline_run_steps`. The CLI exits non-zero if any step failed. The manual trigger (`src/app/api/collect/route.ts`) runs the identical definition. Adding a collector = one entry in `definition.ts`. Each step lives in `src/lib/collectors/` and uses an API client from `src/lib/api-clients/`.
```

- [ ] **Step 2: AC #1 — test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: AC #2 — tokenless collect completes, isolates, exits non-zero**

```bash
env -u GITHUB_TOKEN DATABASE_PATH=$(mktemp -d)/ac2.db npm run collect; echo "exit=$?"
```
Expected: github / events-auto / github-engagement / github-user-enrichment record `failed` (GITHUB_TOKEN not set; user-enrichment may instead be `skipped` via the failed engagement dependency); the six downstream chain steps record `skipped`; config-sync, npm, pypi, deps-dev run (live network); summary printed; `exit=1`.

- [ ] **Step 4: AC #3 — single step list**

```bash
grep -rn "lib/collectors" src/scripts/collect-all.ts src/app/api/collect/route.ts
```
Expected: no output.

- [ ] **Step 5: AC #4 — no silent catches**

```bash
grep -rn "catch {" src/lib/collectors/
```
Expected: no output.

- [ ] **Step 6: AC #5 — build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document pipeline module and npm test in CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage:** AC1 → Task 3 (a–e map to the seven runner tests); AC2 → definition token guards + CLI exit code (Tasks 4, 5, 8); AC3 → Tasks 5, 6; AC4 → Task 7; AC5 → Task 8. User story 9 (identical definition) → Tasks 5+6 import the same `pipelineSteps`. Two-file schema convention → Task 2. CLAUDE.md update (PRD "Further Notes") → Task 8.
- **Out of scope respected:** no retries/parallelism, no run-history UI, collector internals untouched except added log lines.
- **Type consistency:** `PipelineStep { name, dependsOn, run }`, `runPipeline(steps): Promise<RunSummary>`, `validatePipeline(steps): PipelineStep[]` used consistently across Tasks 3–6.
- **Env seam:** `DATABASE_PATH` is read at module load in `client.ts`/`migrate.ts`, so tests set it *before* dynamic `await import()` — static imports would be hoisted and read it too early. Top-level await is supported by Vitest ESM test files.
