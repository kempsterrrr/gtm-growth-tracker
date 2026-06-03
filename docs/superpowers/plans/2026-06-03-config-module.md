# Config Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One config module owns `gtm-config.yaml` — zod-validated parsing, reads/writes, and the one-directional YAML→database sync; the settings route and pipeline become thin callers; the database→YAML regeneration path is deleted (GitHub issue #8).

**Architecture:** New `src/lib/config/gtm-config.ts` exposes `readConfig` / `addRepo` / `addPackage` / `syncToDatabase` (+ `ConfigError`, zod schema, inferred types), all taking an optional `configPath` (the test seam). Writes are YAML-first; the DB projection runs only after a successful file write. The zod schema replaces `src/lib/types/config.ts` (type inferred from schema). `src/scripts/sync-config.ts` is deleted (pipeline step calls `syncToDatabase` directly); the route's `updateYamlConfig` (DB→YAML) is deleted; `seed-history.ts` reads via the module.

**Tech Stack:** zod v4 (already a dependency), `yaml`, Vitest with temp YAML paths + temp `DATABASE_PATH`.

**Key context & constraints:**
- The working tree carries the user's uncommitted **package-name validation WIP** (`src/lib/validation/package-name.ts` untracked; edits to the config route, settings page, and `gtm-config.yaml`). The PRD explicitly builds on it ("validation exists but lives apart from the parsing it should guard"). **Task 0 commits that WIP verbatim as the baseline commit** on the feature branch, clearly labelled — it must not be mixed into module commits. Surface this to the user in the final report.
- `validatePackageName` stays in `src/lib/validation/package-name.ts` because the settings page (a client component) imports it for instant client-side feedback and cannot import a server module that touches fs/db. The config module is the **enforcement point** (applied on every add and every parse) — that is the PRD's actual requirement.
- The settings UI behaviour must be unchanged: POST `/api/config` returns the inserted row (201) or `{error}` (400) with the same validation messages.
- The current YAML (post-WIP) includes an `mlflow` pypi entry and unquoted scalars — the module must read it as-is.
- AC4 note: in this pipeline *every* step depends on `config-sync`, so "independent steps still run" has no applicable steps — the verifiable behaviour is: config-sync records `failed` with a message naming the problem, all dependents record `skipped`, exit 1.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/config/gtm-config.ts` | Create | THE module: zod schema + inferred types, ConfigError, read/add/add/sync |
| `src/lib/config/gtm-config.test.ts` | Create | The 5 PRD test cases against temp YAML + temp DB |
| `src/lib/types/config.ts` | Delete | Shape now inferred from the zod schema |
| `src/scripts/sync-config.ts` | Delete | Pipeline calls `syncToDatabase` directly |
| `src/lib/pipeline/definition.ts` | Modify | config-sync step → `syncToDatabase()` |
| `src/app/api/config/route.ts` | Rewrite | Thin caller; `updateYamlConfig` (DB→YAML) deleted |
| `src/scripts/seed-history.ts` | Modify | Read backfill date via `readConfig` |
| `CLAUDE.md` | Modify | Configuration-flow section: YAML is truth, module owns it |

---

### Task 0: Commit the user's pre-existing validation WIP as the baseline

- [ ] **Step 1: Branch and commit the WIP verbatim**

```bash
git checkout -b feat/config-module
git add src/lib/validation/ src/app/api/config/route.ts src/app/settings/page.tsx gtm-config.yaml
git commit -m "feat: package-name validation on package entry paths (pre-existing WIP)

User-authored work present in the working tree before this PRD's branch:
client+server package-name validation, YAML header preservation, and
github_repo retention in the settings flow."
```

- [ ] **Step 2: Verify clean tree (except plan docs)**

Run: `git status --short` — Expected: nothing except `?? docs/...` if the plan isn't committed yet.

---

### Task 1: The config module (TDD — 5 PRD cases)

**Files:**
- Create: `src/lib/config/gtm-config.test.ts`
- Create: `src/lib/config/gtm-config.ts`

- [ ] **Step 1: Write the failing tests — `src/lib/config/gtm-config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

const tmp = mkdtempSync(path.join(tmpdir(), "gtm-config-test-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");

const { runMigrations } = await import("../db/migrate");
const { readConfig, addRepo, addPackage, syncToDatabase, ConfigError } = await import("./gtm-config");

runMigrations();
const sqlite = new Database(process.env.DATABASE_PATH!);

const VALID_YAML = `github:
  repos:
    - owner: ar-io
      name: ar-io-node
      display_name: AR.IO Node
packages:
  npm:
    - name: "@ardrive/turbo-sdk"
      display_name: Turbo SDK
  pypi:
    - name: turbo-sdk
collection:
  npm_backfill_from: "2024-01-01"
`;

let n = 0;
function freshConfig(): string {
  const p = path.join(tmp, `config-${n++}.yaml`);
  writeFileSync(p, VALID_YAML);
  return p;
}

const count = (table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("readConfig + round-trip", () => {
  it("parses a valid file and round-trips an added repo through YAML and DB", () => {
    const p = freshConfig();
    const config = readConfig(p);
    expect(config.github.repos[0]).toEqual({
      owner: "ar-io",
      name: "ar-io-node",
      display_name: "AR.IO Node",
    });
    expect(config.collection?.npm_backfill_from).toBe("2024-01-01");

    addRepo({ owner: "octo", name: "demo", display_name: "Demo" }, p);
    expect(readConfig(p).github.repos.map((r) => r.name)).toContain("demo");
    const row = sqlite
      .prepare("SELECT * FROM tracked_repos WHERE owner = 'octo' AND name = 'demo'")
      .get();
    expect(row).toBeTruthy();
  });
});

describe("malformed config", () => {
  it("rejects a wrong-shaped file with a message naming the path", () => {
    const p = path.join(tmp, "bad-shape.yaml");
    writeFileSync(p, "github:\n  repos: not-an-array\n");
    expect(() => readConfig(p)).toThrow(ConfigError);
    expect(() => readConfig(p)).toThrow(/github\.repos/);
  });

  it("rejects unparseable YAML with a useful message", () => {
    const p = path.join(tmp, "broken.yaml");
    writeFileSync(p, "github: [unclosed\n  - {{{\n");
    expect(() => readConfig(p)).toThrow(ConfigError);
    expect(() => readConfig(p)).toThrow(/YAML/i);
  });
});

describe("addPackage validation", () => {
  it("rejects invalid names for both registries and leaves YAML and DB untouched", () => {
    const p = freshConfig();
    const yamlBefore = readFileSync(p, "utf-8");
    const dbBefore = count("tracked_packages");

    expect(() => addPackage("npm", { name: "bad name!!" }, p)).toThrow(ConfigError);
    expect(() => addPackage("pypi", { name: "bad/name" }, p)).toThrow(ConfigError);

    expect(readFileSync(p, "utf-8")).toBe(yamlBefore);
    expect(count("tracked_packages")).toBe(dbBefore);
  });

  it("accepts a valid package and projects it to the DB", () => {
    const p = freshConfig();
    addPackage("npm", { name: "left-pad", display_name: "Left Pad" }, p);
    expect(readConfig(p).packages.npm.map((x) => x.name)).toContain("left-pad");
    const row = sqlite
      .prepare("SELECT * FROM tracked_packages WHERE registry = 'npm' AND name = 'left-pad'")
      .get();
    expect(row).toBeTruthy();
  });
});

describe("write-failure atomicity", () => {
  it("leaves the database unchanged when the YAML write fails", () => {
    const p = freshConfig();
    chmodSync(p, 0o444); // read-only: readConfig succeeds, write throws
    const reposBefore = count("tracked_repos");
    expect(() => addRepo({ owner: "ghost", name: "never" }, p)).toThrow();
    expect(count("tracked_repos")).toBe(reposBefore);
    expect(
      sqlite.prepare("SELECT * FROM tracked_repos WHERE owner = 'ghost'").get()
    ).toBeUndefined();
    chmodSync(p, 0o644);
  });
});

describe("syncToDatabase", () => {
  it("is idempotent across repeated runs", () => {
    const p = freshConfig();
    syncToDatabase(p);
    const repos1 = count("tracked_repos");
    const pkgs1 = count("tracked_packages");
    syncToDatabase(p);
    expect(count("tracked_repos")).toBe(repos1);
    expect(count("tracked_packages")).toBe(pkgs1);
    expect(
      sqlite.prepare("SELECT * FROM tracked_repos WHERE owner = 'ar-io' AND name = 'ar-io-node'").get()
    ).toBeTruthy();
  });

  it("skips quietly when the file does not exist", () => {
    expect(() => syncToDatabase(path.join(tmp, "missing.yaml"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/config/gtm-config.test.ts`
Expected: FAIL — cannot resolve `./gtm-config`.

- [ ] **Step 3: Implement `src/lib/config/gtm-config.ts`**

```ts
import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { trackedRepos, trackedPackages } from "../db/schema";
import { validatePackageName } from "../validation/package-name";

/**
 * THE owner of gtm-config.yaml. The YAML file is the source of truth; the
 * tracked_repos / tracked_packages tables are a projection of it
 * (one-directional: YAML → database, via syncToDatabase). Writes are
 * YAML-first — the projection only runs after a successful file write, so a
 * failed write leaves the database untouched. No other module may read or
 * write the file or parse its YAML.
 *
 * validatePackageName lives in src/lib/validation/ (client components import
 * it for instant form feedback); THIS module is the enforcement point — it is
 * applied on every add and on every parse.
 */

const YAML_HEADER = "# ar.io Growth Tracker Configuration\n\n";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const trackedRepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().optional(),
});

const trackedPackageConfigSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().optional(),
  github_repo: z
    .string()
    .regex(/^[^\s/]+\/[^\s/]+$/, 'must be "owner/name"')
    .optional(),
});

export const gtmConfigSchema = z.object({
  github: z.object({ repos: z.array(trackedRepoConfigSchema).default([]) }).default({ repos: [] }),
  packages: z
    .object({
      npm: z.array(trackedPackageConfigSchema).default([]),
      pypi: z.array(trackedPackageConfigSchema).default([]),
    })
    .default({ npm: [], pypi: [] }),
  collection: z.object({ npm_backfill_from: z.string().optional() }).optional(),
});

export type GtmConfig = z.infer<typeof gtmConfigSchema>;
export type TrackedRepoConfig = z.infer<typeof trackedRepoConfigSchema>;
export type TrackedPackageConfig = z.infer<typeof trackedPackageConfigSchema>;
export type PackageRegistry = "npm" | "pypi";

function defaultConfigPath(): string {
  return path.join(process.cwd(), "gtm-config.yaml");
}

export function readConfig(configPath = defaultConfigPath()): GtmConfig {
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }
  let raw: unknown;
  try {
    raw = parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new ConfigError(
      `Invalid YAML in ${path.basename(configPath)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const result = gtmConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid config in ${path.basename(configPath)}: ${details}`);
  }
  const config = result.data;
  // Package-name validation on every parse — every entry path gets it.
  for (const registry of ["npm", "pypi"] as const) {
    for (const pkg of config.packages[registry]) {
      const invalid = validatePackageName(registry, pkg.name);
      if (invalid) {
        throw new ConfigError(
          `Invalid config in ${path.basename(configPath)}: packages.${registry} "${pkg.name}": ${invalid}`
        );
      }
    }
  }
  return config;
}

function writeConfig(config: GtmConfig, configPath: string): void {
  fs.writeFileSync(configPath, YAML_HEADER + stringify(config));
}

export function addRepo(repo: TrackedRepoConfig, configPath = defaultConfigPath()): void {
  const parsed = trackedRepoConfigSchema.safeParse(repo);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid repo: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  const config = readConfig(configPath);
  const existing = config.github.repos.find(
    (r) => r.owner === parsed.data.owner && r.name === parsed.data.name
  );
  if (existing) {
    existing.display_name = parsed.data.display_name ?? existing.display_name;
  } else {
    config.github.repos.push(parsed.data);
  }
  writeConfig(config, configPath); // YAML first
  syncToDatabase(configPath); // projection only after a successful write
}

export function addPackage(
  registry: PackageRegistry,
  pkg: TrackedPackageConfig,
  configPath = defaultConfigPath()
): void {
  const name = (pkg.name ?? "").trim();
  const invalid = validatePackageName(registry, name);
  if (invalid) throw new ConfigError(invalid);
  const parsed = trackedPackageConfigSchema.safeParse({ ...pkg, name });
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid package: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  const config = readConfig(configPath);
  const list = config.packages[registry];
  const existing = list.find((p) => p.name === name);
  if (existing) {
    existing.display_name = parsed.data.display_name ?? existing.display_name;
    existing.github_repo = parsed.data.github_repo ?? existing.github_repo;
  } else {
    list.push(parsed.data);
  }
  writeConfig(config, configPath); // YAML first
  syncToDatabase(configPath); // projection only after a successful write
}

/** Projects the YAML (source of truth) into tracked_repos / tracked_packages.
 *  Idempotent upserts; a missing file is skipped (fresh deployments), a
 *  malformed file throws ConfigError so the pipeline step records `failed`. */
export function syncToDatabase(configPath = defaultConfigPath()): void {
  if (!fs.existsSync(configPath)) {
    console.log("[config] No gtm-config.yaml found, skipping sync");
    return;
  }
  const config = readConfig(configPath);
  const db = getDb();

  for (const repo of config.github.repos) {
    db.insert(trackedRepos)
      .values({ owner: repo.owner, name: repo.name, displayName: repo.display_name || null })
      .onConflictDoUpdate({
        target: [trackedRepos.owner, trackedRepos.name],
        set: { displayName: sql`excluded.display_name` },
      })
      .run();
  }

  for (const registry of ["npm", "pypi"] as const) {
    for (const pkg of config.packages[registry]) {
      let repoId: number | null = null;
      if (pkg.github_repo) {
        const [owner, name] = pkg.github_repo.split("/");
        const repo = db
          .select()
          .from(trackedRepos)
          .where(sql`${trackedRepos.owner} = ${owner} AND ${trackedRepos.name} = ${name}`)
          .get();
        if (repo) repoId = repo.id;
      }
      db.insert(trackedPackages)
        .values({ registry, name: pkg.name, displayName: pkg.display_name || null, repoId })
        .onConflictDoUpdate({
          target: [trackedPackages.registry, trackedPackages.name],
          set: {
            displayName: sql`excluded.display_name`,
            repoId: repoId ? sql`${repoId}` : sql`repo_id`,
          },
        })
        .run();
    }
  }

  console.log(
    `[config] Synced ${config.github.repos.length} repos, ${config.packages.npm.length} npm + ${config.packages.pypi.length} pypi packages`
  );
}
```

(zod v4 note: if `.default()` on objects mis-infers, fall back to making `github`/`packages` required objects with required arrays and tolerate missing sections via `raw ?? {}` preprocessing — adjust during red/green, keeping the malformed-file test strict.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all suites pass (new config tests + existing 32).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/
git commit -m "feat: config module owning gtm-config.yaml (zod-validated, YAML-first writes)"
```

---

### Task 2: Wire the callers; delete the old paths

**Files:**
- Modify: `src/lib/pipeline/definition.ts`
- Rewrite: `src/app/api/config/route.ts`
- Modify: `src/scripts/seed-history.ts`
- Delete: `src/scripts/sync-config.ts`, `src/lib/types/config.ts`

- [ ] **Step 1: Pipeline step calls the module**

In `definition.ts`, replace:
```ts
import { syncConfig } from "../../scripts/sync-config";
```
with:
```ts
import { syncToDatabase } from "../config/gtm-config";
```
and the step:
```ts
  { name: "config-sync", dependsOn: [], run: async () => syncToDatabase() },
```

- [ ] **Step 2: Rewrite `src/app/api/config/route.ts`** (deletes `updateYamlConfig` — AC5)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { trackedRepos, trackedPackages } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { addRepo, addPackage, ConfigError } from "@/lib/config/gtm-config";

export async function GET() {
  const db = getDb();
  const repos = db.select().from(trackedRepos).all();
  const packages = db.select().from(trackedPackages).all();
  return NextResponse.json({ repos, packages });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, data } = body;
  const db = getDb();

  try {
    if (type === "repo") {
      addRepo({ owner: data.owner, name: data.name, display_name: data.displayName || undefined });
      const row = db
        .select()
        .from(trackedRepos)
        .where(sql`${trackedRepos.owner} = ${data.owner} AND ${trackedRepos.name} = ${data.name}`)
        .get();
      return NextResponse.json(row, { status: 201 });
    }

    if (type === "package") {
      const name = (data.name ?? "").trim();
      addPackage(data.registry, { name, display_name: data.displayName || undefined });
      const row = db
        .select()
        .from(trackedPackages)
        .where(sql`${trackedPackages.registry} = ${data.registry} AND ${trackedPackages.name} = ${name}`)
        .get();
      return NextResponse.json(row, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: `seed-history.ts` reads via the module**

Read the file first; replace its `parse(fs.readFileSync(...gtm-config.yaml...))` block with `readConfig()` from `../lib/config/gtm-config`, preserving the `npm_backfill_from` fallback behaviour. Remove now-unused `yaml`/`fs`-for-config imports (keep whatever else the script uses).

- [ ] **Step 4: Delete the superseded files and fix any remaining type imports**

```bash
git rm src/scripts/sync-config.ts src/lib/types/config.ts
grep -rn "types/config\|sync-config" src/ || true
```
Fix any hit by importing types from `@/lib/config/gtm-config`.

- [ ] **Step 5: Verify**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -u src/ && git add src/scripts/seed-history.ts src/lib/pipeline/definition.ts src/app/api/config/route.ts
git commit -m "refactor: settings route, pipeline, and seed script are thin config-module callers"
```

---

### Task 3: CLAUDE.md + verify all acceptance criteria

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md's Configuration flow section**

Replace the existing "### Configuration flow" paragraph with:

```markdown
### Configuration flow

`gtm-config.yaml` is the source of truth for which repos/packages are tracked;
the `tracked_repos`/`tracked_packages` tables are a one-directional projection
of it. `src/lib/config/gtm-config.ts` is the ONLY module that reads or writes
the file: zod-validated parsing (`readConfig`), YAML-first writes
(`addRepo`/`addPackage` — DB projection only after a successful file write),
and `syncToDatabase` (the pipeline's `config-sync` step; malformed YAML fails
the step with a path-named message). Package names are validated by
`src/lib/validation/package-name.ts` (client-safe), enforced inside the config
module on every add and parse. The Settings page edits config through
`src/app/api/config/route.ts`, a thin caller of the module.
```

- [ ] **Step 2: AC1 + AC5 — single owner, no DB→YAML path**

```bash
grep -rn "gtm-config" src/ --include="*.ts" --include="*.tsx" | grep -v "lib/config/gtm-config"
grep -rn "from \"yaml\"\|from 'yaml'" src/ | grep -v "lib/config/gtm-config"
grep -rn "updateYamlConfig" src/
```
Expected: no output from all three.

- [ ] **Step 3: AC2 — npm test** — Expected: PASS including the 5 cases.

- [ ] **Step 4: AC3 — UI flow updates YAML + tables; subsequent collect picks them up**

```bash
cp gtm-config.yaml /tmp/gtm-config.backup.yaml
TMPDB=$(mktemp -d)/ac3.db
DATABASE_PATH=$TMPDB npm run db:migrate
DATABASE_PATH=$TMPDB npx next dev -p 3789 &   # background
sleep 8
curl -s -X POST localhost:3789/api/config -H 'content-type: application/json' \
  -d '{"type":"repo","data":{"owner":"octocat","name":"Hello-World"}}'
curl -s -X POST localhost:3789/api/config -H 'content-type: application/json' \
  -d '{"type":"package","data":{"registry":"npm","name":"left-pad"}}'
grep -n "Hello-World\|left-pad" gtm-config.yaml
sqlite3 $TMPDB "SELECT owner||'/'||name FROM tracked_repos; SELECT registry||':'||name FROM tracked_packages"
kill %1
env -u GITHUB_TOKEN DATABASE_PATH=$TMPDB npm run collect 2>&1 | grep -E "npm|left-pad" | head -5
sqlite3 $TMPDB "SELECT COUNT(*) FROM npm_downloads WHERE package_id = (SELECT id FROM tracked_packages WHERE name='left-pad')"
cp /tmp/gtm-config.backup.yaml gtm-config.yaml
```
Expected: both POSTs return 201 rows; YAML contains both entries; tables contain them; the tokenless collect's npm step succeeds and `npm_downloads` has rows for left-pad. YAML restored afterwards.

- [ ] **Step 5: AC4 — malformed YAML fails the step visibly**

```bash
cp gtm-config.yaml /tmp/gtm-config.backup.yaml
printf 'github:\n  repos: not-an-array\n' > gtm-config.yaml
env -u GITHUB_TOKEN DATABASE_PATH=$(mktemp -d)/ac4.db npm run collect; echo "exit=$?"
cp /tmp/gtm-config.backup.yaml gtm-config.yaml
```
Expected: `config-sync` records `FAILED` with a message containing `github.repos`; every dependent records `skipped` (all steps depend on config-sync — see plan header note); exit=1. Confirm the run-record row carries the message.

- [ ] **Step 6: AC6 — build and lint**

Run: `npm run build && npx eslint src/lib src/scripts src/app/api/config`
Expected: both clean.

- [ ] **Step 7: Commit, push, PR**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-03-config-module.md
git commit -m "docs: config module owns gtm-config.yaml; YAML is source of truth"
```

---

## Self-Review Notes

- **Spec coverage:** Stories 1/2/6 → YAML-first `addRepo`/`addPackage` + one-directional `syncToDatabase` (Tasks 1–2); Story 3 + AC4 → `ConfigError` with path context, verified live (Task 3); Story 4 → zod schema + inferred types replacing `types/config.ts`; Story 5 → enforcement on every add and parse; Story 7 + AC4 → pipeline failure policy; AC1/AC5 greps, AC3 curl flow (the exact route the UI calls), AC6 → Task 3.
- **Documented deviations:** `validatePackageName` file stays where it is (client-component import constraint) with the module as enforcement point; AC4's "independent steps still run" is vacuous in this pipeline (everything depends on config-sync) — verified behaviour is failed + skipped + exit 1.
- **UI unchanged:** route contract preserved (201 row / 400 `{error}` with the same messages the WIP introduced; client-side validation untouched).
- **Type consistency:** `readConfig/addRepo/addPackage/syncToDatabase/ConfigError` named identically in module, tests, route, definition, and seed-history.
