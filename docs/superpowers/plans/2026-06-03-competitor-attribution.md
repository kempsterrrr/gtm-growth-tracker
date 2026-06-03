# Competitor Attribution + Dashboard Totals Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Competitor attribution as a first-class config concept (`competitor:` on repo/package entries + top-level `competitors:` domains block), projected to nullable DB columns by config-sync, with a guard so competitor entities never pollute Overview totals or the four metric pages' default lists (GitHub issue #18, parent PRD #17).

**Architecture:** `gtm-config.yaml` stays the source of truth; `src/lib/config/gtm-config.ts` (the ONLY reader/writer) gains zod-validated `competitor` fields, the `competitors:` block with referential-integrity validation, and one-directional projection of a new nullable `competitor` text column on `tracked_repos`/`tracked_packages`. The guard lives at the API layer: the four metric routes' no-id list paths add `competitor IS NULL`; the Overview computes its totals from those lists, so it is guarded transitively. Detail-by-id paths stay unguarded **by design** — the compare overlay (#20) and reverse-dep mining (#22) read competitor series through them. Settings displays competitor badges and the add-forms pass an optional competitor name through `/api/config`.

**Tech Stack:** zod v4 schemas, Drizzle ORM (better-sqlite3, synchronous), drizzle-kit generated migrations, Vitest (real temp SQLite via `DATABASE_PATH` set before db-module import — never mocks), Next.js App Router routes, shadcn Badge.

**Key facts pinned:**
- **Hard ordering constraint (PRD):** the totals guard must land in the same slice as the config capability — this plan delivers both; tasks 5–8 (guard) and 3–4 (config) are all gated by one PR.
- **Migrate-gate evolution (deviation to document in the PR):** the current "schema equivalence (cutover gate)" test compares a fresh generated DB against the *frozen* legacy DDL — by definition no post-cutover migration can ever pass it. It evolves into an **upgrade-path gate**: legacy DDL + `runMigrations()` must equal fresh `runMigrations()`. Same spirit (both provisioning paths converge, baseline idempotency now actually exercised on a legacy DB), survives schema evolution. The live-data no-op gate is untouched and must pass unmodified.
- Collectors intentionally keep running on competitor entities (PRD: engagement/download benchmarking comes free); **no collector or pipeline-definition changes in this slice**.
- `drizzle/0000_baseline.sql` is frozen; the new columns arrive via a generated `0001` migration (plain `ALTER TABLE ... ADD`, never hand-edited).
- The committed dev DB `data/gtm-tracker.db` is **not** migrated/committed in this PR — the daily collect workflow migrates and pushes it post-merge. The end-to-end demo migrates it locally and then reverts via git.
- Out of scope, noted in PR: the events feed can annotate charts with competitor release events once a competitor repo is added (events-auto runs on all tracked repos). The PRD scopes #18's guard to Overview totals + the four metric pages/APIs; flag for #19/#20 if Will wants the events feed guarded too.
- Zod v4: `z.record(keySchema, valueSchema)` requires both args. Empty `competitors:` key (null) fails parse — same pre-existing behavior as an empty `collection:` key; acceptable.
- No component-test infra exists in the repo — Settings UI is verified by lint + build + the end-to-end demo, stated in the PR.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-competitor-attribution.md` | Create | This plan |
| `src/lib/db/schema.ts` | Modify | `competitor` text column on `trackedRepos` + `trackedPackages` |
| `drizzle/0001_competitor-attribution.sql` + `drizzle/meta/*` | Generate | The migration (drizzle-kit, committed as generated) |
| `src/lib/db/migrate.test.ts` | Modify | Equivalence gate → upgrade-path gate + column assertions |
| `src/lib/config/gtm-config.ts` | Modify | `competitor` fields, `competitors:` block, referential validation, projection |
| `src/lib/config/gtm-config.test.ts` | Modify | Round-trip, one-directional sync, block validation tests |
| `src/app/api/metrics/npm/route.ts` + `.test.ts` | Modify | List guard + exclusion tests |
| `src/app/api/metrics/github/route.ts` | Modify | List guard |
| `src/app/api/metrics/github/route.test.ts` | Create | Exclusion + by-id tests |
| `src/app/api/metrics/pypi/route.ts` | Modify | List guard |
| `src/app/api/metrics/pypi/route.test.ts` | Create | Exclusion + by-id tests |
| `src/app/api/metrics/dependencies/route.ts` | Modify | List guard |
| `src/app/api/metrics/dependencies/route.test.ts` | Create | Exclusion + by-id tests |
| `src/lib/types/api.ts` | Modify | `competitor: string \| null` on `TrackedRepoRow`/`TrackedPackageRow` |
| `src/app/api/config/route.ts` | Modify | POST passes `competitor` through |
| `src/app/api/config/route.test.ts` | Create | GET carries competitor; POST round-trips it |
| `src/app/settings/page.tsx` | Modify | Competitor inputs on both forms + badges on rows |
| `CLAUDE.md` | Modify | Competitor attribution + guard conventions |

No changes: collectors, pipeline definition/runner, Overview page (`src/app/page.tsx` — totals derive from the guarded list APIs), metric pages (render guarded API data).

---

### Task 1: Branch + commit the plan

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/competitor-attribution
```

- [ ] **Step 2: Commit this plan**

```bash
git add docs/superpowers/plans/2026-06-03-competitor-attribution.md
git commit -m "docs: implementation plan for competitor attribution + totals guard (#18)"
```

---

### Task 2: Schema columns + generated migration + migrate-gate evolution

**Files:**
- Modify: `src/lib/db/schema.ts` (trackedRepos ~line 14, trackedPackages ~line 29)
- Modify: `src/lib/db/migrate.test.ts:393-406` (the equivalence describe block)
- Generate: `drizzle/0001_competitor-attribution.sql`, `drizzle/meta/0001_snapshot.json`, `drizzle/meta/_journal.json`

- [ ] **Step 1: Evolve the equivalence gate (refactor while green)**

In `src/lib/db/migrate.test.ts`, replace the whole `describe("schema equivalence (cutover gate)", ...)` block (lines 393–406) with:

```ts
describe("schema equivalence (upgrade-path gate)", () => {
  // The original cutover gate compared a fresh generated DB against the
  // frozen legacy DDL — impossible to satisfy once post-cutover migrations
  // exist. The evolved gate asserts both provisioning paths converge: a
  // legacy pre-cutover DB upgraded by the migrator (idempotent baseline +
  // later migrations) must equal a freshly migrated DB.
  it("a legacy DB upgraded by the migrator matches a fresh generated DB", () => {
    const legacyPath = path.join(tmp, "legacy.db");
    const legacyDb = new Database(legacyPath);
    legacyDb.exec(LEGACY_SCHEMA_SQL);
    legacyDb.close();
    process.env.DATABASE_PATH = legacyPath;
    runMigrations();

    const genPath = path.join(tmp, "generated.db");
    process.env.DATABASE_PATH = genPath;
    runMigrations();

    const upgradedDb = new Database(legacyPath);
    const genDb = new Database(genPath);
    expect(snapshot(genDb)).toEqual(snapshot(upgradedDb));
    genDb.close();
    upgradedDb.close();
  });
});
```

- [ ] **Step 2: Run the migrate suite to verify the refactor is green**

Run: `npx vitest run src/lib/db/migrate.test.ts`
Expected: PASS (2 tests) — the baseline applies idempotently to the legacy DB; no 0001 exists yet so both paths are identical.

- [ ] **Step 3: Add the failing column assertions**

Append inside the same `describe("schema equivalence (upgrade-path gate)", ...)` block:

```ts
  it("the migrations add the nullable competitor attribution columns", () => {
    process.env.DATABASE_PATH = path.join(tmp, "columns.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>)
        .filter((c) => c.name === "competitor");
    expect(cols("tracked_repos")).toEqual([{ name: "competitor", notnull: 0 }]);
    expect(cols("tracked_packages")).toEqual([{ name: "competitor", notnull: 0 }]);
    db.close();
  });
```

Note: `PRAGMA table_info` rows carry more keys (`cid`, `type`, `dflt_value`, `pk`) — map them away first. Final form:

```ts
  it("the migrations add the nullable competitor attribution columns", () => {
    process.env.DATABASE_PATH = path.join(tmp, "columns.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const competitorCol = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>)
        .filter((c) => c.name === "competitor")
        .map((c) => ({ name: c.name, notnull: c.notnull }));
    expect(competitorCol("tracked_repos")).toEqual([{ name: "competitor", notnull: 0 }]);
    expect(competitorCol("tracked_packages")).toEqual([{ name: "competitor", notnull: 0 }]);
    db.close();
  });
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/lib/db/migrate.test.ts`
Expected: FAIL — `competitorCol("tracked_repos")` returns `[]`.

- [ ] **Step 5: Add the columns to the schema source of truth**

In `src/lib/db/schema.ts`, `trackedRepos` gains one line after `displayName`:

```ts
    displayName: text("display_name"),
    competitor: text("competitor"),
```

`trackedPackages` gains the same line after its `displayName`:

```ts
    displayName: text("display_name"),
    competitor: text("competitor"),
```

- [ ] **Step 6: Generate the migration**

```bash
npx drizzle-kit generate --name competitor-attribution
```

Review `drizzle/0001_competitor-attribution.sql` — it must contain exactly two statements (no table recreation):

```sql
ALTER TABLE `tracked_packages` ADD `competitor` text;--> statement-breakpoint
ALTER TABLE `tracked_repos` ADD `competitor` text;
```

(Statement order may differ; both must be plain `ADD` of a nullable text column.) `drizzle/meta/_journal.json` gains the 0001 entry and `drizzle/meta/0001_snapshot.json` appears. Never hand-edit these.

- [ ] **Step 7: Run the migrate suite to verify green (all three gates)**

Run: `npx vitest run src/lib/db/migrate.test.ts`
Expected: PASS (3 tests) — upgrade-path equivalence (legacy also receives 0001), column assertions, and the untouched live-data no-op gate against the committed production DB.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.test.ts drizzle/
git commit -m "feat: nullable competitor column on tracked repos/packages; migrate gate covers upgrade path"
```

---

### Task 3: Config module — entry-level `competitor` field + one-directional projection

**Files:**
- Modify: `src/lib/config/gtm-config.ts` (schemas ~lines 32-45, addRepo ~118, addPackage ~144, syncToDatabase ~165-198)
- Test: `src/lib/config/gtm-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/config/gtm-config.test.ts`:

```ts
describe("competitor attribution (entry-level)", () => {
  it("round-trips competitor on repos and packages through YAML and DB projection", () => {
    const p = freshConfig();
    addRepo({ owner: "them", name: "their-repo", competitor: "Acme" }, p);
    addPackage("npm", { name: "acme-sdk", competitor: "Acme" }, p);

    const config = readConfig(p);
    expect(config.github.repos.find((r) => r.name === "their-repo")?.competitor).toBe("Acme");
    expect(config.packages.npm.find((x) => x.name === "acme-sdk")?.competitor).toBe("Acme");

    const repoRow = sqlite
      .prepare("SELECT competitor FROM tracked_repos WHERE owner = 'them' AND name = 'their-repo'")
      .get() as { competitor: string | null };
    expect(repoRow.competitor).toBe("Acme");
    const pkgRow = sqlite
      .prepare("SELECT competitor FROM tracked_packages WHERE registry = 'npm' AND name = 'acme-sdk'")
      .get() as { competitor: string | null };
    expect(pkgRow.competitor).toBe("Acme");
  });

  it("projects one-directionally: removing competitor from YAML nulls the DB column on re-sync", () => {
    const p = path.join(tmp, "one-directional.yaml");
    const withCompetitor = `github:
  repos:
    - owner: flip
      name: flop
      competitor: Acme
`;
    writeFileSync(p, withCompetitor);
    syncToDatabase(p);
    const before = sqlite
      .prepare("SELECT competitor FROM tracked_repos WHERE owner = 'flip' AND name = 'flop'")
      .get() as { competitor: string | null };
    expect(before.competitor).toBe("Acme");

    writeFileSync(p, withCompetitor.replace("      competitor: Acme\n", ""));
    syncToDatabase(p);
    const after = sqlite
      .prepare("SELECT competitor FROM tracked_repos WHERE owner = 'flip' AND name = 'flop'")
      .get() as { competitor: string | null };
    expect(after.competitor).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/config/gtm-config.test.ts`
Expected: FAIL — zod strips the unknown `competitor` key, so the round-trip reads `undefined`; the projection never writes the column.

- [ ] **Step 3: Implement — schemas, merge, projection**

In `src/lib/config/gtm-config.ts`:

(a) Both entry schemas gain the optional field:

```ts
const trackedRepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().optional(),
  competitor: z.string().min(1).optional(),
});

const trackedPackageConfigSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().optional(),
  github_repo: z
    .string()
    .regex(/^[^\s/]+\/[^\s/]+$/, 'must be "owner/name"')
    .optional(),
  competitor: z.string().min(1).optional(),
});
```

(b) `addRepo` merge branch (existing entry) gains:

```ts
  if (existing) {
    existing.display_name = parsed.data.display_name ?? existing.display_name;
    existing.competitor = parsed.data.competitor ?? existing.competitor;
  } else {
```

(c) `addPackage` merge branch gains:

```ts
  if (existing) {
    existing.display_name = parsed.data.display_name ?? existing.display_name;
    existing.github_repo = parsed.data.github_repo ?? existing.github_repo;
    existing.competitor = parsed.data.competitor ?? existing.competitor;
  } else {
```

(d) `syncToDatabase` projects the column in both upserts — `excluded.competitor` in the set clause is what makes removal null the column (one-directional):

```ts
  for (const repo of config.github.repos) {
    db.insert(trackedRepos)
      .values({
        owner: repo.owner,
        name: repo.name,
        displayName: repo.display_name || null,
        competitor: repo.competitor || null,
      })
      .onConflictDoUpdate({
        target: [trackedRepos.owner, trackedRepos.name],
        set: {
          displayName: sql`excluded.display_name`,
          competitor: sql`excluded.competitor`,
        },
      })
      .run();
  }
```

and in the package loop:

```ts
      db.insert(trackedPackages)
        .values({
          registry,
          name: pkg.name,
          displayName: pkg.display_name || null,
          repoId,
          competitor: pkg.competitor || null,
        })
        .onConflictDoUpdate({
          target: [trackedPackages.registry, trackedPackages.name],
          set: {
            displayName: sql`excluded.display_name`,
            repoId: repoId ? sql`${repoId}` : sql`repo_id`,
            competitor: sql`excluded.competitor`,
          },
        })
        .run();
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/lib/config/gtm-config.test.ts`
Expected: PASS (all, including the pre-existing suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/gtm-config.ts src/lib/config/gtm-config.test.ts
git commit -m "feat: competitor field on config entries, projected one-directionally to the DB"
```

---

### Task 4: Config module — `competitors:` block + referential integrity

**Files:**
- Modify: `src/lib/config/gtm-config.ts` (gtmConfigSchema ~line 47, readConfig validation ~line 99)
- Test: `src/lib/config/gtm-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/config/gtm-config.test.ts`:

```ts
describe("competitors block", () => {
  it("parses a block whose names are used by a repo or a package, defaulting domains", () => {
    const p = path.join(tmp, "block-used.yaml");
    writeFileSync(
      p,
      `github:
  repos:
    - owner: them
      name: their-repo
      competitor: Acme
packages:
  npm: []
  pypi:
    - name: rival-sdk
      competitor: Rival
competitors:
  Acme:
    domains:
      - acme.dev
      - acme.io
  Rival: {}
`
    );
    const config = readConfig(p);
    expect(config.competitors?.Acme?.domains).toEqual(["acme.dev", "acme.io"]);
    expect(config.competitors?.Rival?.domains).toEqual([]);
  });

  it("rejects a block entry referencing a name no entry uses, naming it", () => {
    const p = path.join(tmp, "block-orphan.yaml");
    writeFileSync(
      p,
      `github:
  repos:
    - owner: us
      name: our-repo
competitors:
  Ghost:
    domains:
      - ghost.io
`
    );
    expect(() => readConfig(p)).toThrow(ConfigError);
    expect(() => readConfig(p)).toThrow(/Ghost/);
  });

  it("accepts competitor entries with no competitors block", () => {
    const p = path.join(tmp, "no-block.yaml");
    writeFileSync(
      p,
      `github:
  repos:
    - owner: them
      name: their-repo
      competitor: Acme
`
    );
    expect(() => readConfig(p)).not.toThrow();
    expect(readConfig(p).competitors).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/config/gtm-config.test.ts`
Expected: FAIL — first test reads `competitors` as `undefined` (zod strips the unknown top-level key); second test does NOT throw.

- [ ] **Step 3: Implement — block schema + validation**

In `src/lib/config/gtm-config.ts`:

(a) Above `gtmConfigSchema`:

```ts
const competitorDomainsSchema = z.object({
  domains: z.array(z.string().min(1)).default([]),
});
```

(b) `gtmConfigSchema` gains the optional block (between `packages` and `collection`):

```ts
export const gtmConfigSchema = z.object({
  github: z
    .object({ repos: z.array(trackedRepoConfigSchema).default([]) })
    .default({ repos: [] }),
  packages: z
    .object({
      npm: z.array(trackedPackageConfigSchema).default([]),
      pypi: z.array(trackedPackageConfigSchema).default([]),
    })
    .default({ npm: [], pypi: [] }),
  competitors: z.record(z.string().min(1), competitorDomainsSchema).optional(),
  collection: z.object({ npm_backfill_from: z.string().optional() }).optional(),
});
```

(c) In `readConfig`, after the package-name validation loop (before `return config;`):

```ts
  // Referential integrity: every competitors-block entry must be used by at
  // least one repo or package entry, so typos surface immediately instead of
  // silently disabling employee tagging. Entries without a block are fine —
  // tagging falls back to the org/commit signals.
  if (config.competitors) {
    const used = new Set<string>();
    for (const repo of config.github.repos) {
      if (repo.competitor) used.add(repo.competitor);
    }
    for (const registry of ["npm", "pypi"] as const) {
      for (const pkg of config.packages[registry]) {
        if (pkg.competitor) used.add(pkg.competitor);
      }
    }
    for (const name of Object.keys(config.competitors)) {
      if (!used.has(name)) {
        throw new ConfigError(
          `Invalid config in ${path.basename(configPath)}: competitors block declares "${name}" but no repo or package entry uses it`
        );
      }
    }
  }
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/lib/config/gtm-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/gtm-config.ts src/lib/config/gtm-config.test.ts
git commit -m "feat: competitors domains block with referential-integrity validation"
```

---

### Task 5: npm route — exclude competitor packages from the default list

**Files:**
- Modify: `src/app/api/metrics/npm/route.ts:18`
- Test: `src/app/api/metrics/npm/route.test.ts`

- [ ] **Step 1: Extend the existing test — seed a competitor package**

In `src/app/api/metrics/npm/route.test.ts`, after the existing seeding block (after line 36), add:

```ts
// A competitor-attributed package: must be invisible to the default list but
// still served by id (the compare overlay in #20 reads it).
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='rival-pkg'").get() as { id: number }
).id;
for (let d = 1; d <= 6; d++) insert.run(rivalId, daysAgoIso(d), 999);
```

And append a test inside the existing `describe`:

```ts
  it("excludes competitor-attributed packages from the default list but serves them by id", async () => {
    const listRes = await GET(new NextRequest("http://localhost/api/metrics/npm"));
    const list = (await listRes.json()) as NpmPackageSummary[];
    expect(list.map((p) => p.name)).not.toContain("rival-pkg");

    const detailRes = await GET(
      new NextRequest(`http://localhost/api/metrics/npm?packageId=${rivalId}`)
    );
    const detail = (await detailRes.json()) as DownloadRow[];
    expect(detail.length).toBe(6);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/npm/route.test.ts`
Expected: FAIL — the first pre-existing test now sees 2 summaries (`toHaveLength(1)` breaks) and the new test finds `rival-pkg` in the list.

- [ ] **Step 3: Implement the guard**

In `src/app/api/metrics/npm/route.ts`, add `isNull` to the drizzle import (line 4):

```ts
import { eq, and, gte, lte, sql, desc, isNull } from "drizzle-orm";
```

and change the list query (line 18):

```ts
    const packages = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "npm"), isNull(trackedPackages.competitor)))
      .all();
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/metrics/npm/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/metrics/npm/route.ts src/app/api/metrics/npm/route.test.ts
git commit -m "feat: npm metrics list excludes competitor packages"
```

---

### Task 6: github route — exclude competitor repos from the default list

**Files:**
- Modify: `src/app/api/metrics/github/route.ts:23`
- Create: `src/app/api/metrics/github/route.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/app/api/metrics/github/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { GithubRepoSummary, GithubRepoMetricsResponse } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare("INSERT INTO tracked_repos (owner, name, display_name) VALUES ('us', 'our-repo', 'Ours')")
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, display_name, competitor) VALUES ('them', 'their-repo', 'Theirs', 'Acme')"
  )
  .run();
const ourId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='our-repo'").get() as { id: number }
).id;
const theirId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='their-repo'").get() as { id: number }
).id;
const insert = sqlite.prepare(
  "INSERT INTO github_repo_metrics (repo_id, date, stars, forks, watchers, open_issues, contributors) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
insert.run(ourId, "2026-06-01", 10, 5, 3, 2, 1);
insert.run(theirId, "2026-06-01", 5000, 100, 50, 40, 30);

describe("GET /api/metrics/github (seeded temp DB)", () => {
  it("excludes competitor-attributed repos from the default list", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/github"));
    const body = (await res.json()) as GithubRepoSummary[];
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("our-repo");
    expect(body[0].stars).toBe(10);
  });

  it("still serves a competitor repo's series by id (compare overlay reads it)", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/github?repoId=${theirId}&metric=stars`)
    );
    const body = (await res.json()) as GithubRepoMetricsResponse;
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics![0].stars).toBe(5000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/github/route.test.ts`
Expected: FAIL — list returns 2 repos.

- [ ] **Step 3: Implement the guard**

In `src/app/api/metrics/github/route.ts`, import `isNull` (line 10):

```ts
import { eq, and, gte, lte, desc, isNull } from "drizzle-orm";
```

and change the list query (line 23):

```ts
    const repos = db.select().from(trackedRepos).where(isNull(trackedRepos.competitor)).all();
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/metrics/github/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/metrics/github/route.ts src/app/api/metrics/github/route.test.ts
git commit -m "feat: github metrics list excludes competitor repos"
```

---

### Task 7: pypi route — exclude competitor packages from the default list

**Files:**
- Modify: `src/app/api/metrics/pypi/route.ts:17-21`
- Create: `src/app/api/metrics/pypi/route.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/app/api/metrics/pypi/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { PypiPackageSummary, PypiDownloadRow } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { daysAgoIso } = await import("@/lib/dates");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare("INSERT INTO tracked_packages (registry, name, display_name) VALUES ('pypi', 'our-pkg', 'Ours')")
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('pypi', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();
const ourId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='our-pkg'").get() as { id: number }
).id;
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='rival-pkg'").get() as { id: number }
).id;
const insert = sqlite.prepare(
  "INSERT INTO pypi_downloads (package_id, date, downloads, category) VALUES (?, ?, ?, 'overall')"
);
for (let d = 1; d <= 3; d++) {
  insert.run(ourId, daysAgoIso(d), 10);
  insert.run(rivalId, daysAgoIso(d), 999);
}

describe("GET /api/metrics/pypi (seeded temp DB)", () => {
  it("excludes competitor-attributed packages from the default list", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/pypi"));
    const body = (await res.json()) as PypiPackageSummary[];
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("our-pkg");
    expect(body[0].downloadsLast7d).toBe(30);
  });

  it("still serves a competitor package's series by id (compare overlay reads it)", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/pypi?packageId=${rivalId}`)
    );
    const body = (await res.json()) as PypiDownloadRow[];
    expect(body).toHaveLength(3);
    expect(body[0].downloads).toBe(999);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/pypi/route.test.ts`
Expected: FAIL — list returns 2 packages.

- [ ] **Step 3: Implement the guard**

In `src/app/api/metrics/pypi/route.ts`, import `isNull` (line 4):

```ts
import { eq, and, gte, lte, sql, isNull } from "drizzle-orm";
```

and change the list query (lines 17–21):

```ts
    const packages = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "pypi"), isNull(trackedPackages.competitor)))
      .all();
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/metrics/pypi/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/metrics/pypi/route.ts src/app/api/metrics/pypi/route.test.ts
git commit -m "feat: pypi metrics list excludes competitor packages"
```

---

### Task 8: dependencies route — exclude competitor packages from the default list

**Files:**
- Modify: `src/app/api/metrics/dependencies/route.ts:21`
- Create: `src/app/api/metrics/dependencies/route.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/app/api/metrics/dependencies/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { DependencySummary, DependencyDetailResponse } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare("INSERT INTO tracked_packages (registry, name, display_name) VALUES ('npm', 'our-pkg', 'Ours')")
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();
const ourId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='our-pkg'").get() as { id: number }
).id;
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='rival-pkg'").get() as { id: number }
).id;
const insertCount = sqlite.prepare(
  "INSERT INTO reverse_dependency_counts (package_id, date, count) VALUES (?, ?, ?)"
);
insertCount.run(ourId, "2026-06-01", 7);
insertCount.run(rivalId, "2026-06-01", 1000);
sqlite
  .prepare(
    "INSERT INTO reverse_dependencies (package_id, dependent_name, dependent_registry, first_seen) VALUES (?, 'consumer-app', 'npm', '2026-05-01')"
  )
  .run(rivalId);

describe("GET /api/metrics/dependencies (seeded temp DB)", () => {
  it("excludes competitor-attributed packages from the default list", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/dependencies"));
    const body = (await res.json()) as DependencySummary[];
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("our-pkg");
    expect(body[0].dependentCount).toBe(7);
  });

  it("still serves a competitor package's dependents by id (#22 reverse-dep mining reads them)", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/dependencies?packageId=${rivalId}`)
    );
    const body = (await res.json()) as DependencyDetailResponse;
    expect(body.counts).toHaveLength(1);
    expect(body.dependents.map((d) => d.dependentName)).toContain("consumer-app");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/dependencies/route.test.ts`
Expected: FAIL — list returns 2 packages.

- [ ] **Step 3: Implement the guard**

In `src/app/api/metrics/dependencies/route.ts`, import `isNull` (line 9):

```ts
import { eq, and, gte, lte, desc, isNull } from "drizzle-orm";
```

and change the list query (line 21):

```ts
    const packages = db.select().from(trackedPackages).where(isNull(trackedPackages.competitor)).all();
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/metrics/dependencies/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/metrics/dependencies/route.ts src/app/api/metrics/dependencies/route.test.ts
git commit -m "feat: dependencies list excludes competitor packages"
```

---

### Task 9: API contract + `/api/config` competitor passthrough

**Files:**
- Modify: `src/lib/types/api.ts:114-126`
- Modify: `src/app/api/config/route.ts:26,37`
- Create: `src/app/api/config/route.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/app/api/config/route.test.ts`. Note: the config module resolves `gtm-config.yaml` from `process.cwd()` at call time, so the test chdirs into a temp dir (vitest `pool: "forks"` — process-local, isolated) so POSTs write a scratch file, never the repo's real config:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { ConfigResponse } from "@/lib/types/api";

const tmp = mkdtempSync(path.join(tmpdir(), "gtm-config-route-test-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");

const { runMigrations } = await import("@/lib/db/migrate");
const { GET, POST } = await import("./route");

runMigrations(); // resolves the migrations folder from the repo cwd — run BEFORE chdir

// The config module resolves gtm-config.yaml from process.cwd() at call time;
// point cwd at the temp dir so POSTs write a scratch file, not the repo's.
const cwdBefore = process.cwd();
process.chdir(tmp);
writeFileSync(
  path.join(tmp, "gtm-config.yaml"),
  "github:\n  repos: []\npackages:\n  npm: []\n  pypi: []\n"
);
afterAll(() => process.chdir(cwdBefore));

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'rival-pkg', 'Rival', 'Acme')"
  )
  .run();

describe("/api/config (seeded temp DB)", () => {
  it("GET carries competitor attribution on tracked rows", async () => {
    const res = await GET();
    const body = (await res.json()) as ConfigResponse;
    const rival = body.packages.find((p) => p.name === "rival-pkg");
    expect(rival?.competitor).toBe("Acme");
  });

  it("POST adds a repo with a competitor name (YAML first, DB projection)", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({
          type: "repo",
          data: { owner: "them", name: "their-repo", competitor: "Acme" },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { competitor: string | null };
    expect(row.competitor).toBe("Acme");
    expect(readFileSync(path.join(tmp, "gtm-config.yaml"), "utf-8")).toContain("competitor: Acme");
  });

  it("POST adds a package with a competitor name", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({
          type: "package",
          data: { registry: "npm", name: "acme-sdk", competitor: "Acme" },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { competitor: string | null };
    expect(row.competitor).toBe("Acme");
  });
});
```

(The GET test pins the contract — it is already green because the route selects full rows; the POST tests are the red ones.)

- [ ] **Step 2: Run to verify the POST tests fail**

Run: `npx vitest run src/app/api/config/route.test.ts`
Expected: FAIL — POST drops `competitor` (the route doesn't pass it to `addRepo`/`addPackage`), so `row.competitor` is `null`.

- [ ] **Step 3: Implement — contract types + passthrough**

In `src/lib/types/api.ts`, both config rows gain the field:

```ts
export interface TrackedRepoRow {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
  competitor: string | null;
}
export interface TrackedPackageRow {
  id: number;
  registry: string;
  name: string;
  displayName: string | null;
  repoId: number | null;
  competitor: string | null;
}
```

In `src/app/api/config/route.ts`, the repo branch (line 26):

```ts
      addRepo({
        owner: data.owner,
        name: data.name,
        display_name: data.displayName || undefined,
        competitor: data.competitor || undefined,
      });
```

and the package branch (line 37):

```ts
      addPackage(data.registry, {
        name,
        display_name: data.displayName || undefined,
        competitor: data.competitor || undefined,
      });
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/config/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/api.ts src/app/api/config/route.ts src/app/api/config/route.test.ts
git commit -m "feat: /api/config carries competitor attribution; contract types updated"
```

---

### Task 10: Settings page — competitor inputs + badges

**Files:**
- Modify: `src/app/settings/page.tsx`

No component-test infra exists in this repo (established in PRD #10); this task is verified by lint + build + the Task 12 demo.

- [ ] **Step 1: Add form state**

Next to the existing form state (lines 18–27):

```ts
  const [repoCompetitor, setRepoCompetitor] = useState("");
```
(after `repoDisplayName`), and

```ts
  const [pkgCompetitor, setPkgCompetitor] = useState("");
```
(after `pkgDisplayName`).

- [ ] **Step 2: Pass competitor in both POST bodies and reset it**

In `addRepo` (page function, line 40): body data becomes

```ts
        data: {
          owner: repoOwner,
          name: repoName,
          displayName: repoDisplayName || undefined,
          competitor: repoCompetitor.trim() || undefined,
        },
```

and after the POST add `setRepoCompetitor("");` beside the other resets.

In `addPackage` (line 61): body data becomes

```ts
        data: {
          registry: pkgRegistry,
          name: pkgName.trim(),
          displayName: pkgDisplayName || undefined,
          competitor: pkgCompetitor.trim() || undefined,
        },
```

and add `setPkgCompetitor("");` beside the other resets (the success path, after `setPkgDisplayName("")`).

- [ ] **Step 3: Add the competitor input to both forms**

In the repo form, after the Display Name `<div>` (inside the same `grid grid-cols-3 gap-3` — the fourth field wraps to a second row):

```tsx
                  <div>
                    <label className="text-sm font-medium block mb-1">Competitor (optional)</label>
                    <input
                      type="text"
                      value={repoCompetitor}
                      onChange={(e) => setRepoCompetitor(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="Acme"
                    />
                  </div>
```

In the package form, after its Display Name `<div>`:

```tsx
                  <div>
                    <label className="text-sm font-medium block mb-1">Competitor (optional)</label>
                    <input
                      type="text"
                      value={pkgCompetitor}
                      onChange={(e) => setPkgCompetitor(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="Acme"
                    />
                  </div>
```

- [ ] **Step 4: Render competitor badges on tracked rows**

Repo row (line 176–184) — replace the trailing `<Badge variant="outline" className="text-xs">GitHub</Badge>` with:

```tsx
                    <div className="flex items-center gap-2">
                      {repo.competitor && (
                        <Badge variant="secondary" className="text-xs">
                          {repo.competitor}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">GitHub</Badge>
                    </div>
```

Package row (line 273–281) — replace `<Badge variant="outline" className="text-xs">{pkg.registry}</Badge>` with:

```tsx
                    <div className="flex items-center gap-2">
                      {pkg.competitor && (
                        <Badge variant="secondary" className="text-xs">
                          {pkg.competitor}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">{pkg.registry}</Badge>
                    </div>
```

(`secondary` exists in `src/components/ui/badge.tsx` variants.)

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: settings shows competitor badges and adds entries with a competitor name"
```

---

### Task 11: CLAUDE.md conventions

**Files:**
- Modify: `CLAUDE.md` ("Configuration flow" section)

- [ ] **Step 1: Document the competitor conventions**

In the "Configuration flow" section, after the sentence about package-name validation, add:

```markdown
Repo and package entries accept an optional `competitor: <name>` (absent =
our own); an optional top-level `competitors:` block maps name →
`{ domains: [...] }` and is validated referentially on every parse — a block
name no repo/package entry uses is rejected (entries without a block entry
are fine). config-sync projects a nullable `competitor` column onto both
tracked tables one-directionally (removing the field nulls the column).
Dashboard guard: the metric list endpoints — and therefore the Overview
totals derived from them — exclude competitor-attributed entities
(`competitor IS NULL`); detail-by-id endpoints intentionally still serve them
(the competitor compare overlay depends on this).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: competitor attribution + totals-guard conventions in CLAUDE.md"
```

---

### Task 12: Full verification + end-to-end demo

The issue's demo: *add a competitor repo + package to config, run config-sync — they appear labeled in Settings, and every existing total/list is unchanged.*

- [ ] **Step 1: Full test suite, lint, build**

```bash
npm test && npm run lint && npm run build
```
Expected: all green.

- [ ] **Step 2: Migrate the local dev DB and capture the baseline**

```bash
npm run db:migrate
npm run dev   # background; wait for ready
for ep in github npm pypi dependencies; do
  curl -s "http://localhost:3000/api/metrics/$ep" > "/tmp/baseline-$ep.json"
done
curl -s http://localhost:3000/api/config > /tmp/baseline-config.json
```

- [ ] **Step 3: Add demo competitor entries to `gtm-config.yaml`**

Append a repo under `github.repos`, a package under `packages.npm`, and a top-level block (use obviously-fake names so nothing real gets collected if anything leaks):

```yaml
# under github: repos:
    - owner: demo-rival
      name: demo-repo
      competitor: DemoRival
# under packages: npm:
    - name: demo-rival-sdk
      competitor: DemoRival
# top-level:
competitors:
  DemoRival:
    domains:
      - demorival.example
```

Then sync (one-off scratch script, not committed):

```bash
echo 'import { syncToDatabase } from "./src/lib/config/gtm-config"; syncToDatabase();' > /tmp/demo-sync.mts
npx tsx /tmp/demo-sync.mts
```

- [ ] **Step 4: Verify labels appear and totals are unchanged**

```bash
curl -s http://localhost:3000/api/config | python3 -m json.tool | grep -A2 -B2 DemoRival   # entries present, labeled
for ep in github npm pypi dependencies; do
  diff <(curl -s "http://localhost:3000/api/metrics/$ep") "/tmp/baseline-$ep.json" && echo "$ep unchanged"
done
```
Expected: config shows both demo entries with `"competitor": "DemoRival"`; all four diffs empty. Load `http://localhost:3000/settings` and confirm the DemoRival badges render (screenshot for the PR if feasible).

- [ ] **Step 5: Revert the demo completely**

```bash
# stop the dev server first (it holds the DB open)
git checkout -- gtm-config.yaml
sqlite3 data/gtm-tracker.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
git checkout -- data/gtm-tracker.db
rm -f /tmp/demo-sync.mts
git status   # must be clean apart from the branch's committed work
```
Expected: `git status` shows no changes to `gtm-config.yaml` or `data/` (the local migration of the dev DB is reverted too — the daily collect workflow migrates and commits the production DB after merge).

---

### Task 13: PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/competitor-attribution
gh pr create --title "Competitor attribution model in config/schema + dashboard totals guard" --body "$(cat <<'EOF'
Closes #18 (parent PRD #17).

## What

Competitor attribution as a first-class config concept + the dashboard totals guard, in one slice (the PRD's hard ordering constraint: the guard must exist before any competitor entry can sync).

## Per-AC verification

| AC | Evidence |
|---|---|
| `competitor:` on entries + `competitors:` block round-trip through read/add/sync | `gtm-config.test.ts` — "competitor attribution (entry-level)" + "competitors block" suites |
| Validation rejects orphan block entry; entries without a block are valid | `gtm-config.test.ts` — orphan-rejection (names the offender) + no-block tests |
| Migration adds nullable columns and passes both gates | `migrate.test.ts` — upgrade-path equivalence, column assertions, live-data no-op against the committed DB |
| config-sync projects one-directionally | `gtm-config.test.ts` — removal-nulls-the-column test |
| Overview + four metric pages/APIs exclude competitor entities | 4 route test suites (exclusion + by-id retention); Overview totals derive from the guarded lists; E2E demo: four API payloads byte-identical after adding demo competitor entries |
| Settings shows labels and adds entries with a competitor | Badges + form fields; `/api/config` POST round-trip test; demo screenshot |
| API contract types updated | `TrackedRepoRow`/`TrackedPackageRow` gain `competitor: string \| null` |

## Deviations / notes

1. **Migrate gate evolved**: the frozen-legacy equivalence test can never pass once post-cutover migrations exist; it now asserts legacy-DDL + migrator ≡ fresh migrator (same spirit, exercises baseline idempotency on a legacy DB for real). Live-data gate untouched.
2. **Detail-by-id endpoints intentionally still serve competitor entities** — the compare overlay (#20) and reverse-dep mining (#22) read them; only no-id list paths are guarded.
3. **Committed dev DB not migrated in this PR** — the daily collect workflow migrates + pushes it post-merge.
4. **Events feed not guarded** (out of #18's AC scope): once a competitor repo is added, its release events would annotate charts; flag if you want it folded into #19/#20.
5. No component-test infra exists, so the Settings UI is covered by the API-level POST tests + lint/build + the demo, not component tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Hand off for review**

Will reviews and says "merge" — never merge unprompted.

---

## Self-Review

1. **Spec coverage:** AC1 → Tasks 3+4; AC2 → Task 4; AC3 → Task 2; AC4 → Task 3 (one-directional test); AC5 → Tasks 5–8 + Overview-derives-from-lists fact + Task 12 demo; AC6 → Tasks 9+10; AC7 → Task 9. End-to-end demo → Task 12. No gaps.
2. **Placeholder scan:** none — every code step shows the code, every run step has the command + expected outcome.
3. **Type consistency:** `competitor` is `z.string().min(1).optional()` in config schemas, `text("competitor")` (nullable) in the DB schema, `string | null` on the contract rows; `excluded.competitor` set-clause name matches the column name; test seeds use the `competitor` column name throughout.
