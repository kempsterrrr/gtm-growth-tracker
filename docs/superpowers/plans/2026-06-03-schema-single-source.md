# Schema Single Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `src/lib/db/schema.ts` the single source of truth (including indexes and CHECK constraints), generate migrations with drizzle-kit, delete the hand-written SQL block, and protect the cutover with a schema-equivalence test and a live-data no-op test (GitHub issue #7).

**Architecture:** Port the legacy DDL's UNIQUE table constraints, CHECK constraints, 13 non-unique indexes, and `datetime('now')` defaults into the Drizzle definitions; `npx drizzle-kit generate --name=baseline` produces `drizzle/0000_baseline.sql` which is hand-edited to be idempotent (`IF NOT EXISTS`) — **that idempotent baseline IS the cutover strategy** for the committed production DB (it applies cleanly to a DB that already has every table; the migrator then records it and future migrations apply normally). `runMigrations()` becomes a thin adapter over Drizzle's migrator with the DB path resolved at call time. Alert-rule seeding moves out of DDL into a `seed-defaults` pipeline step.

**Tech Stack:** drizzle-kit 0.31.10 (`generate`), `drizzle-orm/better-sqlite3/migrator`, Vitest, `sqlite_master`/PRAGMA-based schema normalisation.

**Key decisions & constraints:**
- The PRD suggests "record the baseline as applied without running it". That mechanism breaks if an existing DB lags the baseline (and couples us to migrator-internal hash bookkeeping). The idempotent-baseline approach achieves the same guarantee — existing DBs are not damaged, fresh DBs are fully created — with no internals coupling. Documented in the migrate module.
- Use `unique()` **table constraints** (not `uniqueIndex()`) so uniqueness is emitted inline in `CREATE TABLE` — matching the legacy `UNIQUE(...)` autoindex form and avoiding duplicate index creation on existing DBs. Column-level `.unique()` (github_users.login, companies.domain, enrichment_queue.user_login) stays as-is.
- Defaults: replace every `.$defaultFn(() => new Date().toISOString())` with `.default(sql`(datetime('now'))`)` so the default appears in generated DDL — one defaulting mechanism, identical to the legacy DDL. (New rows get SQLite's `YYYY-MM-DD HH:MM:SS` format instead of ISO-`T` — that is what the legacy DDL always declared; collectors that need ISO set values explicitly.)
- Author check expressions with **exactly the legacy spacing** (e.g. `IN ('npm', 'pypi')`) so the equivalence normaliser only has to strip identifier quoting.
- The committed `data/gtm-tracker.db` already has all 24 tables (incl. pipeline tables) — the live-data test runs against a copy of it. Treat it as the hard gate.
- Working tree carries unrelated user WIP — stage only files this plan touches.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/db/schema.ts` | Modify | Single source: + checks, + unique table constraints, + 13 indexes, + DDL defaults |
| `drizzle/0000_baseline.sql` + `drizzle/meta/*` | Generate & commit | Generated baseline migration (hand-edited to IF NOT EXISTS) + journal/snapshot |
| `src/lib/db/migrate.ts` | Rewrite | Thin migrator adapter; DB path at call time; cutover doc; hand-written SQL deleted |
| `src/lib/db/migrate.test.ts` | Create | Equivalence test (vs frozen legacy DDL) + live-data no-op test |
| `src/lib/db/seed-defaults.ts` | Create | Default alert rules as data seeding (out of DDL) |
| `src/lib/pipeline/definition.ts` | Modify | Register `seed-defaults` step; alerts-evaluator depends on it |
| `src/lib/pipeline/definition.test.ts` | Modify | 14 steps; new name in list |
| `Dockerfile` | Modify | `COPY --from=builder /app/drizzle ./drizzle` |
| `CLAUDE.md` | Modify | Replace "TWO places" section with single-source workflow |

---

### Task 1: Port constraints, indexes, and DDL defaults into `schema.ts`

**Files:**
- Modify: `src/lib/db/schema.ts`

The authority for what to port is the legacy SQL block currently in `src/lib/db/migrate.ts` (24 `CREATE TABLE`s, 13 `CREATE INDEX`es, 11 CHECKs).

- [ ] **Step 1: Update imports**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, unique, index, check } from "drizzle-orm/sqlite-core";
```
(`uniqueIndex` is no longer used anywhere after this task.)

- [ ] **Step 2: Apply the default-value rule everywhere**

Replace every occurrence of
```ts
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
```
with
```ts
      .notNull()
      .default(sql`(datetime('now'))`),
```
(13 occurrences: trackedRepos.createdAt, trackedPackages.createdAt, githubRepoMetrics.collectedAt, events.createdAt, githubUsers.createdAt, githubEngagementEvents.collectedAt, companies.createdAt, companies.updatedAt, alertRules.createdAt, alertEvents.firedAt, slackConfig.updatedAt, enrichmentQueue.createdAt, collectionCursors.updatedAt.)

- [ ] **Step 3: Convert every `uniqueIndex(...)` extra to a `unique(...)` table constraint and add the missing checks/indexes**

Worked example (tracked_packages):
```ts
  (table) => [
    unique("tracked_packages_registry_name").on(table.registry, table.name),
    check("tracked_packages_registry_check", sql`${table.registry} IN ('npm', 'pypi')`),
  ]
```

Complete extras per table (legacy-matching index names; check expressions spaced exactly like the legacy SQL):

| Table | Extras array contents |
|---|---|
| tracked_repos | `unique("tracked_repos_owner_name").on(owner, name)` |
| tracked_packages | unique(registry, name); check registry `IN ('npm', 'pypi')` |
| github_repo_metrics | unique(repoId, date); `index("idx_github_repo_metrics_date").on(repoId, date)` |
| github_traffic_clones | unique(repoId, date); `index("idx_github_traffic_clones_date").on(repoId, date)` |
| github_traffic_views | unique(repoId, date); `index("idx_github_traffic_views_date").on(repoId, date)` |
| npm_downloads | unique(packageId, date); `index("idx_npm_downloads_date").on(packageId, date)` |
| pypi_downloads | unique(packageId, date, category, categoryValue); `index("idx_pypi_downloads_date").on(packageId, date)` |
| reverse_dependencies | unique(packageId, dependentName, dependentRegistry) |
| reverse_dependency_counts | unique(packageId, date); `index("idx_reverse_dep_counts_date").on(packageId, date)` |
| events | check category `IN ('release', 'dependency_added', 'blog_post', 'conference', 'upstream_inclusion', 'custom')`; check source `IN ('auto', 'manual')`; `index("idx_events_date").on(date)` |
| github_users | (column `.unique()` on login stays) — no extras |
| github_user_emails | check source `IN ('commit', 'profile')`; unique(userId, email) |
| github_user_orgs | unique(userId, orgLogin) |
| github_engagement_events | check eventType `IN ('star', 'fork', 'issue', 'pr', 'commit', 'issue_comment', 'pr_review')`; unique(repoId, userId, eventType, githubEventId); `index("idx_engagement_events_repo_user").on(repoId, userId)`; `index("idx_engagement_events_user").on(userId)` |
| companies | (column `.unique()` on domain stays) — no extras |
| github_user_companies | check source `IN ('email_domain', 'profile_company', 'org_membership', 'manual')`; unique(userId, companyId) |
| company_scores | unique(companyId, repoId, date); `index("idx_company_scores_date").on(companyId, date)` |
| alert_rules | check ruleType `IN ('score_threshold', 'new_company', 'engagement_spike', 'new_enterprise_user')` |
| alert_events | `index("idx_alert_events_fired").on(firedAt)` |
| slack_config | check `${table.id} = 1` |
| enrichment_queue | check status `IN ('pending', 'processing', 'done', 'failed')`; `index("idx_enrichment_queue_status").on(status, priority)` |
| collection_cursors | unique("collection_cursors_unique").on(cursorType, repoId) |
| pipeline_runs | check status `IN ('running', 'success', 'failed')` |
| pipeline_run_steps | check status `IN ('success', 'failed', 'skipped')`; unique("pipeline_run_steps_run_step").on(runId, stepName); `index("idx_pipeline_run_steps_run").on(runId)` |

Tables that currently have no extras callback (events, githubUsers→none needed, githubUserEmails, githubUserOrgs, githubEngagementEvents→already has uniqueIndex, alertRules, alertEvents, slackConfig, enrichmentQueue, pipelineRuns) gain one where the table above says so.

- [ ] **Step 4: Verify nothing breaks**

Run: `npm test && npx tsc --noEmit 2>/dev/null || npm run build`
Expected: 30 tests pass (queries are unaffected by extras), build/typecheck succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: schema.ts carries checks, unique constraints, indexes, and DDL defaults"
```

---

### Task 2: Generate the baseline migration and make it idempotent

**Files:**
- Create (generated): `drizzle/0000_baseline.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`

- [ ] **Step 1: Generate**

```bash
npx drizzle-kit generate --name=baseline
```
Expected: creates `drizzle/0000_baseline.sql` with 24 CREATE TABLE + index statements, plus `drizzle/meta/`.

- [ ] **Step 2: Make the baseline idempotent** (this is the documented cutover strategy)

```bash
sed -i '' -e 's/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /' -e 's/^CREATE INDEX /CREATE INDEX IF NOT EXISTS /' -e 's/^CREATE UNIQUE INDEX /CREATE UNIQUE INDEX IF NOT EXISTS /' drizzle/0000_baseline.sql
```
Then read the file and verify: every CREATE statement has IF NOT EXISTS; checks/uniques/defaults/FKs are present inline.

- [ ] **Step 3: Sanity-run against a fresh temp DB using drizzle's migrator directly**

```bash
node -e "
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const db = new Database(require('os').tmpdir() + '/gen-check-' + process.pid + '.db');
migrate(drizzle(db), { migrationsFolder: './drizzle' });
console.log(db.prepare(\"SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'\").get());
"
```
Expected: `{ n: 24 }`.

- [ ] **Step 4: Commit**

```bash
git add drizzle/
git commit -m "feat: generated baseline migration (idempotent IF NOT EXISTS cutover)"
```

---

### Task 3: Cutover `migrate.ts` (TDD — equivalence + live-data gates)

**Files:**
- Create: `src/lib/db/migrate.test.ts`
- Rewrite: `src/lib/db/migrate.ts`

- [ ] **Step 1: Write the failing tests — `src/lib/db/migrate.test.ts`**

The legacy DDL fixture is the current hand-written block from `migrate.ts` (DDL only — **omit** the `INSERT OR IGNORE INTO alert_rules` seed). Structure:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

const tmp = mkdtempSync(path.join(tmpdir(), "gtm-migrate-test-"));
// runMigrations resolves DATABASE_PATH at call time (new behaviour), so a
// static import is fine and the env var is set per test.
const { runMigrations } = await import("./migrate");

/** Frozen copy of the pre-cutover hand-written DDL (no seed data). */
const LEGACY_SCHEMA_SQL = `
  <paste the full sqlite.exec DDL block from the current migrate.ts, with the
   "-- Seed default alert rules" INSERT statement removed>
`;

// ── Schema normalisation ────────────────────────────────────────────────
type TableSnapshot = {
  columns: Array<{ name: string; type: string; notnull: number; dflt: string | null; pk: number }>;
  uniques: string[];          // sorted "col1,col2" tuples from unique indexes (any origin)
  indexes: string[];          // sorted "name(col1,col2)" for NON-unique indexes
  checks: string[];           // sorted normalised CHECK expressions
  fks: string[];              // sorted "from->table.to"
  autoincrement: boolean;
};

function normalizeExpr(s: string): string {
  // strip identifier quoting and collapse whitespace; single-quoted values untouched
  return s.replace(/[`"]/g, "").replace(/\s+/g, " ").trim();
}

function extractChecks(createSql: string): string[] {
  // balanced-paren scan: find every CHECK( ... ) including nested parens
  const checks: string[] = [];
  const re = /CHECK\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(createSql))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < createSql.length && depth > 0) {
      if (createSql[i] === "(") depth++;
      else if (createSql[i] === ")") depth--;
      i++;
    }
    checks.push(normalizeExpr(createSql.slice(start, i - 1)));
  }
  return checks.sort();
}

function snapshot(db: InstanceType<typeof Database>): Record<string, TableSnapshot> {
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
    )
    .all() as Array<{ name: string; sql: string }>;
  const out: Record<string, TableSnapshot> = {};
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t.name})`).all() as any[]).map((c) => ({
      name: c.name,
      type: String(c.type).toUpperCase(),
      notnull: c.pk ? 1 : c.notnull, // INTEGER PRIMARY KEY is implicitly not-null; normalise
      dflt: c.dflt_value === null ? null : normalizeExpr(String(c.dflt_value)).replace(/^\((.*)\)$/, "$1"),
      pk: c.pk,
    }));
    const idxList = db.prepare(`PRAGMA index_list(${t.name})`).all() as any[];
    const uniques: string[] = [];
    const indexes: string[] = [];
    for (const idx of idxList) {
      const colNames = (db.prepare(`PRAGMA index_info(${idx.name})`).all() as any[])
        .sort((a, b) => a.seqno - b.seqno)
        .map((c) => c.name)
        .join(",");
      if (idx.unique) uniques.push(colNames);
      else indexes.push(`${idx.name}(${colNames})`);
    }
    const fks = (db.prepare(`PRAGMA foreign_key_list(${t.name})`).all() as any[])
      .map((f) => `${f.from}->${f.table}.${f.to}`)
      .sort();
    out[t.name] = {
      columns: cols,
      uniques: [...new Set(uniques)].sort(), // dedupe: autoindex + named index on same cols are equivalent
      indexes: indexes.sort(),
      checks: extractChecks(t.sql),
      fks,
      autoincrement: /AUTOINCREMENT/i.test(t.sql),
    };
  }
  return out;
}

function rowCounts(db: InstanceType<typeof Database>): Record<string, number> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'"
    )
    .all() as Array<{ name: string }>;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    counts[t.name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number }).n;
  }
  return counts;
}

describe("schema equivalence (cutover gate)", () => {
  it("generated migrations produce a schema identical to the legacy hand-written SQL", () => {
    const legacyDb = new Database(path.join(tmp, "legacy.db"));
    legacyDb.exec(LEGACY_SCHEMA_SQL);

    process.env.DATABASE_PATH = path.join(tmp, "generated.db");
    runMigrations();
    const genDb = new Database(process.env.DATABASE_PATH);

    expect(snapshot(genDb)).toEqual(snapshot(legacyDb));
    legacyDb.close();
    genDb.close();
  });
});

describe("live-data migration (hard gate)", () => {
  it("applies to a copy of the committed production DB without error or data loss", () => {
    const committed = path.join(process.cwd(), "data", "gtm-tracker.db");
    const copy = path.join(tmp, "live.db");
    copyFileSync(committed, copy);

    const beforeDb = new Database(copy, { readonly: true });
    const before = rowCounts(beforeDb);
    beforeDb.close();
    expect(Object.keys(before).length).toBeGreaterThan(20); // sanity: real DB

    process.env.DATABASE_PATH = copy;
    runMigrations();

    const db = new Database(copy);
    expect(rowCounts(db)).toEqual(before);
    const applied = db.prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`).get() as { n: number };
    expect(applied.n).toBeGreaterThan(0);
    db.close();
  });
});
```

Note: the normaliser may need iteration once the real generated DDL's quirks are visible (e.g. default-value parenthesisation, type-name casing). Iterate the *normaliser* only for pure representation differences — never paper over a missing constraint, column, or index.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/db/migrate.test.ts`
Expected: FAIL — live-data test can't find `__drizzle_migrations` (old hand-written migrate doesn't create it); equivalence may also fail on defaults.

- [ ] **Step 3: Rewrite `src/lib/db/migrate.ts`** (deletes the entire hand-written DDL + seed block)

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";

/**
 * Applies the drizzle-kit generated migrations in ./drizzle.
 *
 * Single-source cutover: the schema used to be authored twice (Drizzle
 * definitions + a hand-written SQL block here). src/lib/db/schema.ts is now
 * the single source of truth; migrations are generated from it with
 * `npx drizzle-kit generate`.
 *
 * Baseline strategy for pre-cutover databases: drizzle/0000_baseline.sql is
 * hand-edited to be idempotent (CREATE ... IF NOT EXISTS), so on a database
 * that already has every table it applies as a no-op and is then recorded by
 * the migrator; on a fresh database it creates the full schema. Migrations
 * AFTER the baseline are generated plain and must not be hand-edited.
 *
 * Default alert-rule seeding moved to the `seed-defaults` pipeline step
 * (src/lib/db/seed-defaults.ts) — migrations are pure DDL.
 */
export function runMigrations() {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "gtm-tracker.db");

  // Ensure the data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  sqlite.close();
  console.log("Migrations complete.");
}
```

(DB path now resolved at **call time** — strictly more flexible for the temp-`DATABASE_PATH` test seam; existing tests already set the env var before calling.)

- [ ] **Step 4: Run tests to verify they pass — iterate the normaliser on representation-only diffs**

Run: `npm test`
Expected: PASS (all suites, including the two new gates). If equivalence fails, inspect the diff: a missing check/index/unique/default means **fix schema.ts**; a quoting/casing difference means fix the normaliser.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/migrate.ts src/lib/db/migrate.test.ts
git commit -m "feat: cut over to generated migrations; delete hand-written DDL (equivalence + live-data gated)"
```

---

### Task 4: `seed-defaults` pipeline step

**Files:**
- Create: `src/lib/db/seed-defaults.ts`
- Modify: `src/lib/pipeline/definition.ts`
- Modify: `src/lib/pipeline/definition.test.ts`

- [ ] **Step 1: Create `src/lib/db/seed-defaults.ts`** (data formerly seeded by migration DDL)

```ts
import { getDb } from "./client";
import { alertRules } from "./schema";

/** Idempotently seeds default data (formerly embedded in the hand-written
 *  migration). Runs as the `seed-defaults` pipeline step — migrations stay
 *  pure DDL. */
export function seedDefaults() {
  const db = getDb();
  db.insert(alertRules)
    .values([
      {
        id: 1,
        name: "High-engagement company",
        description: "Fires when a company reaches meaningful engagement from multiple people",
        ruleType: "score_threshold",
        config: '{"min_score":15,"min_users":2}',
        enabled: 1,
        notifySlack: 1,
      },
      {
        id: 2,
        name: "Engagement spike",
        description: "Fires when a company's score doubles in a week",
        ruleType: "engagement_spike",
        config: '{"percent_increase":100,"window_days":7}',
        enabled: 1,
        notifySlack: 1,
      },
    ])
    .onConflictDoNothing()
    .run();
  console.log("[seed-defaults] Default alert rules ensured");
}
```

- [ ] **Step 2: Register in `src/lib/pipeline/definition.ts`**

Add import:
```ts
import { seedDefaults } from "../db/seed-defaults";
```
Add as the second step (right after config-sync):
```ts
  { name: "seed-defaults", dependsOn: ["config-sync"], run: async () => seedDefaults() },
```
And make the alerts evaluator depend on it (it reads alert_rules):
```ts
  { name: "alerts-evaluator", dependsOn: ["company-scoring", "seed-defaults"], run: () => evaluateAlerts() },
```

- [ ] **Step 3: Update `src/lib/pipeline/definition.test.ts`**

- `toHaveLength(13)` → `toHaveLength(14)`; `size).toBe(13)` → `14`; comment "config-sync + 12 collectors" → "config-sync + seed-defaults + 12 collectors".
- Add `"seed-defaults"` to the expected-names array.

- [ ] **Step 4: Verify (incl. AC5 semantics)**

Run: `npm test`
Expected: PASS.
Then prove a fresh DB ends up with the rules after one collect (no token needed — seeding is independent of GitHub):
```bash
TMPDB=$(mktemp -d)/fresh.db
DATABASE_PATH=$TMPDB npm run db:migrate
env -u GITHUB_TOKEN DATABASE_PATH=$TMPDB npm run collect; echo "collect exit=$? (1 expected: github steps fail tokenless)"
sqlite3 $TMPDB "SELECT id, name FROM alert_rules ORDER BY id"
```
Expected: migrate creates DB with **zero** alert rules; after collect, rows `1|High-engagement company` and `2|Engagement spike` exist; `seed-defaults` shows `SUCCESS` in the run summary.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/seed-defaults.ts src/lib/pipeline/definition.ts src/lib/pipeline/definition.test.ts
git commit -m "feat: move default alert-rule seeding from migration DDL to a pipeline step"
```

---

### Task 5: Dockerfile, CLAUDE.md, and full AC verification

**Files:**
- Modify: `Dockerfile`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Ship the migrations folder in the Docker image**

After the `COPY --from=builder /app/gtm-config.yaml ./gtm-config.yaml` line add:
```dockerfile
# Copy generated migrations (runMigrations reads ./drizzle at runtime)
COPY --from=builder /app/drizzle ./drizzle
```

- [ ] **Step 2: Replace CLAUDE.md's "TWO places" section (AC6)**

Replace the whole "### Schema is defined in TWO places — keep them in sync" section (heading + 3 paragraphs/bullets) with:

```markdown
### Schema single source of truth

`src/lib/db/schema.ts` is the ONLY schema authority — tables, indexes, UNIQUE
and CHECK constraints, and DDL defaults all live there. Migrations are
generated from it: after editing the schema run `npx drizzle-kit generate`,
review the new SQL file in `drizzle/`, and commit it (plus `drizzle/meta/`).
`npm run db:migrate` (and every collect run) applies pending migrations via
Drizzle's migrator. The baseline migration `drizzle/0000_baseline.sql` is
intentionally idempotent (`IF NOT EXISTS`) so it applies cleanly to
pre-cutover databases; never hand-edit later migrations. Schema changes are
gated by `src/lib/db/migrate.test.ts` (equivalence + live-data no-op tests).
Data seeding (default alert rules) is the `seed-defaults` pipeline step, not
DDL.
```

Also update the architecture step count: "all 13 steps" → "all 14 steps (`config-sync`, `seed-defaults`, the five independent metric collectors …".

- [ ] **Step 3: AC1 — single schema source**

```bash
grep -rn "CREATE TABLE" src/ --include="*.ts" | grep -v ".test.ts"
```
Expected: no output (the only DDL in src/ is the frozen legacy fixture inside the test).

- [ ] **Step 4: AC2 — npm test**

Run: `npm test` — Expected: PASS (equivalence gate + live-data gate included).

- [ ] **Step 5: AC3 — fresh checkout works end to end**

```bash
TMPDB=$(mktemp -d)/ac3.db
DATABASE_PATH=$TMPDB npm run db:migrate
set -a; source .env.local; set +a
DATABASE_PATH=$TMPDB npm run collect; echo "exit=$?"
```
Expected: migrate creates a working DB; collect runs all 14 steps `success`, exit 0.

- [ ] **Step 6: AC4 — committed-DB migration preserves row counts** (also covered by the live-data test)

```bash
TMPLIVE=$(mktemp -d)/live.db && cp data/gtm-tracker.db $TMPLIVE
DATABASE_PATH=$TMPLIVE npm run db:migrate && sqlite3 $TMPLIVE "SELECT COUNT(*) FROM github_users; SELECT COUNT(*) FROM __drizzle_migrations"
```
Expected: completes without error; counts match the source DB; 1 applied migration recorded.

- [ ] **Step 7: AC7 — build and lint**

Run: `npm run build && npx eslint src/lib src/scripts drizzle.config.ts`
Expected: build passes; touched dirs lint clean (the 5 pre-existing dashboard-page errors remain out of scope, as documented in PRs #11/#12).

- [ ] **Step 8: Commit**

```bash
git add Dockerfile CLAUDE.md
git commit -m "docs: single-source schema workflow; ship migrations in Docker image"
```

---

## Self-Review Notes

- **Spec coverage:** Story 1–3 → Task 1 (+ Task 2 generation); Story 4 + AC4 → live-data gate (Task 3) and AC4 re-run (Task 5); Story 5 + AC2 → equivalence gate (Task 3); Story 6 → `runMigrations()` signature/entry points unchanged (`src/scripts/migrate.ts` and both pipeline adapters call it as before); Story 7 + AC5 → Task 4; AC1/AC3/AC6/AC7 → Task 5.
- **Deviation from PRD mechanism, documented:** "record baseline as applied without running" replaced by an idempotent baseline (rationale: an existing DB that lags the baseline would be silently left incomplete by record-only; idempotent-apply has no migrator-internals coupling). The PRD's *guarantee* — existing DBs migrate losslessly, fresh DBs are complete — is what the two test gates prove.
- **Out of scope respected:** no table shape changes (equivalence test enforces this literally); no repository abstraction.
- **Type consistency:** `runMigrations()` keeps its exported name/signature; `seedDefaults()` used in Task 4 definition matches its Task 4 module; snapshot/rowCounts helpers are local to the test file.
- **Known acceptable diffs the normaliser handles:** identifier quoting (backticks/double quotes), type-name casing, implicit vs explicit NOT NULL on `INTEGER PRIMARY KEY`, autoindex-vs-named unique index representation (deduped by column tuple), default-value parenthesisation.
