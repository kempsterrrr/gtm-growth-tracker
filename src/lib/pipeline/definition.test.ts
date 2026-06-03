import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-definition-test-")),
  "test.db"
);

const { pipelineSteps } = await import("./definition");
const { validatePipeline } = await import("./runner");

describe("pipelineSteps", () => {
  it("registers 14 uniquely-named steps (config-sync + seed-defaults + 12 collectors)", () => {
    expect(pipelineSteps).toHaveLength(14);
    expect(new Set(pipelineSteps.map((s) => s.name)).size).toBe(14);
  });

  it("registers the expected step names", () => {
    expect(pipelineSteps.map((s) => s.name).sort()).toEqual(
      [
        "config-sync",
        "seed-defaults",
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
