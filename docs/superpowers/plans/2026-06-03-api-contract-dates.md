# Shared API Contract Types & Date Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name the page⇄route contract in one shared types module imported by both sides (drift = compile error), and define date/growth semantics once in a dates module used by routes, collectors, hooks, and pages (GitHub issue #9).

**Architecture:** `src/lib/dates.ts` (pure: `toIsoDate`, `todayIso`, `daysAgoIso` with optional base for deterministic tests, `growthPercent` preserving the existing zero-previous→0 semantics) replaces all 12 `.toISOString().split("T")[0]` sites and both route-local `getDateDaysAgo` helpers. `src/lib/types/api.ts` declares every dashboard GET payload (re-exporting, not duplicating, the existing `TrackedEvent`/`CompanySummary`/`CompanyDetail`/`FiredAlert` shared types); routes annotate their payload consts with the contract types; pages delete their local response interfaces and import the contract.

**Tech Stack:** TypeScript only (no runtime validation per PRD), Vitest (pure dates tests + one seeded route-handler invocation test).

**Key facts pinned by survey (preserve exactly — "no payload semantics change"):**
- Growth (npm route): `previous > 0 ? ((current - previous) / previous) * 100 : 0`.
- Windows: last7d = `date >= daysAgo(7)`; prev7d = `daysAgo(14) <= date <= daysAgo(7)`.
- 12 date-expression sites: 3 routes (npm, pypi, companies), 5 collectors (github, npm ×2, deps-dev, alerts-evaluator ×2, company-scoring), npm-client `formatDate`, `use-dashboard-filters` hook, events page, npm page.
- `github-engagement.ts` uses full `.toISOString()` timestamps (no `.split`) and `?.split("T")[0]` on **API-returned strings** — both outside AC1's grep; leave them.
- Duplicated page interfaces: NpmSummary/NpmPackage (exact dup), DepSummary (exact dup), DownloadRow ×3, EventRow ×4, GithubSummary⊂GithubRepo.
- `src/components/charts/TimeSeriesChart.tsx` declares `ChartEvent` with `description?: string`; contract `TrackedEvent.description` is `string | null` → widen ChartEvent's field to `string | null` so TrackedEvent[] is assignable (prop-type widening, zero behaviour change).
- The 5 pre-existing `react-hooks/set-state-in-effect` lint **errors** live in pages this PR touches — they are the metric-page-shell PRD's scope; this PR must introduce no NEW lint problems but does not fix those.
- Check `src/lib/types/metrics.ts` usage: if nothing imports it, delete it (AC2: shapes exist exactly once); if something does, reconcile by re-exporting from the contract.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/dates.ts` | Create | THE date/growth semantics: toIsoDate, todayIso, daysAgoIso, growthPercent |
| `src/lib/dates.test.ts` | Create | Pure unit tests via base-date param |
| `src/lib/types/api.ts` | Create | THE route⇄page contract (+ re-exports of existing shared types) |
| `src/app/api/metrics/npm/route.test.ts` | Create | Seeded route-invocation test (prior art for route testing) |
| 3 routes + 5 collectors + npm-client + hook + 2 pages | Modify | Migrate date expressions |
| 8 route files | Modify | Annotate GET payloads with contract types |
| 8 pages + TimeSeriesChart | Modify | Delete local interfaces; import contract; widen ChartEvent.description |
| `src/lib/types/metrics.ts` | Delete if unused | Superseded by contract |
| `CLAUDE.md` | Modify | Document contract + dates conventions |

---

### Task 1: Dates module (TDD)

**Files:** Create `src/lib/dates.test.ts`, `src/lib/dates.ts`

- [ ] **Step 1: Failing tests — `src/lib/dates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toIsoDate, todayIso, daysAgoIso, growthPercent } from "./dates";

const BASE = new Date("2026-06-15T12:00:00Z");

describe("toIsoDate", () => {
  it("formats a Date as YYYY-MM-DD (UTC)", () => {
    expect(toIsoDate(BASE)).toBe("2026-06-15");
  });
});

describe("todayIso", () => {
  it("uses the base date when provided", () => {
    expect(todayIso(BASE)).toBe("2026-06-15");
  });
  it("returns a YYYY-MM-DD string for the real clock", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("daysAgoIso", () => {
  it("subtracts N days from the base date", () => {
    expect(daysAgoIso(7, BASE)).toBe("2026-06-08");
    expect(daysAgoIso(14, BASE)).toBe("2026-06-01");
    expect(daysAgoIso(0, BASE)).toBe("2026-06-15");
  });
  it("crosses month boundaries", () => {
    expect(daysAgoIso(20, BASE)).toBe("2026-05-26");
  });
});

describe("growthPercent", () => {
  it("computes percentage growth", () => {
    expect(growthPercent(110, 100)).toBe(10);
    expect(growthPercent(50, 100)).toBe(-50);
  });
  it("returns 0 when previous is 0 (existing route semantics)", () => {
    expect(growthPercent(42, 0)).toBe(0);
    expect(growthPercent(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/dates.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/dates.ts`**

```ts
/**
 * THE definition of date and growth semantics for the whole app — routes,
 * collectors, hooks, and pages all import from here so "last 7 days" and
 * "growth" mean exactly one thing. Pure functions only (client-safe); the
 * optional base-date parameters exist for deterministic tests.
 */

const DAY_MS = 86_400_000;

/** A Date as the app's canonical YYYY-MM-DD (UTC) string. */
export function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** Today as YYYY-MM-DD. */
export function todayIso(base: Date = new Date()): string {
  return toIsoDate(base);
}

/** N days before the base date as YYYY-MM-DD. */
export function daysAgoIso(days: number, base: Date = new Date()): string {
  return toIsoDate(new Date(base.getTime() - days * DAY_MS));
}

/** Percentage growth from previous to current; 0 when previous is 0
 *  (matches the dashboard's existing summary-card semantics). */
export function growthPercent(current: number, previous: number): number {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}
```

- [ ] **Step 4: Verify green** — `npm test` → all pass.
- [ ] **Step 5: Commit** — `git add src/lib/dates.ts src/lib/dates.test.ts && git commit -m "feat: dates module — one definition of ISO dates, windows, and growth"`

---

### Task 2: Migrate all 12 date-expression sites

**Files:** `src/app/api/metrics/npm/route.ts`, `src/app/api/metrics/pypi/route.ts`, `src/app/api/companies/route.ts`, `src/lib/collectors/{github,npm,deps-dev,alerts-evaluator,company-scoring}.ts`, `src/lib/api-clients/npm-client.ts`, `src/lib/hooks/use-dashboard-filters.ts`, `src/app/events/page.tsx`, `src/app/npm/page.tsx`

Each edit: add the needed import from `@/lib/dates` (or relative `../dates` / `../../dates` in lib code), replace the expression, delete dead local helpers.

- [ ] **Step 1: Routes**
  - npm route: delete `getDateDaysAgo`; `getDateDaysAgo(7)`→`daysAgoIso(7)`, `getDateDaysAgo(14)`→`daysAgoIso(14)`; `const growth = previous > 0 ? ... : 0` → `const growth = growthPercent(current, previous)`.
  - pypi route: delete `getDateDaysAgo`; call sites → `daysAgoIso(7)`.
  - companies route: `const today = new Date().toISOString().split("T")[0]` → `const today = todayIso()`; `const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]` → `const sevenDaysAgo = daysAgoIso(7)`.

- [ ] **Step 2: Collectors + client**
  - github.ts / deps-dev.ts / company-scoring.ts / alerts-evaluator.ts: `const today = new Date().toISOString().split("T")[0]` → `todayIso()`.
  - alerts-evaluator.ts line ~65: `new Date(Date.now() - windowDays * 86400000).toISOString().split("T")[0]` → `daysAgoIso(windowDays)`.
  - npm.ts (both occurrences): the three-line `yesterday` dance → `const dateStr = daysAgoIso(1);` / `const endDate = daysAgoIso(1);`.
  - npm-client.ts: delete local `formatDate`, import `toIsoDate` and use it at the call sites (or alias `import { toIsoDate as formatDate }`).

- [ ] **Step 3: Client-side**
  - use-dashboard-filters.ts: `startDate.toISOString().split("T")[0]` → `toIsoDate(startDate)`, same for endDate (imports from `@/lib/dates`; pure module, client-safe).
  - events/page.tsx: `useState(new Date().toISOString().split("T")[0])` → `useState(todayIso())`.
  - npm/page.tsx: `weekStart.toISOString().split("T")[0]` → `toIsoDate(weekStart)`.

- [ ] **Step 4: AC1 verification + regression**

```bash
grep -rn 'toISOString().split' src/ | grep -v "src/lib/dates.ts"
grep -rn "getDateDaysAgo" src/
```
Expected: no output from either. Then `npm test && npm run build` → green.

- [ ] **Step 5: Commit** — `git add -u src/ && git commit -m "refactor: all date windows and growth go through the dates module"`

---

### Task 3: Contract module + route annotations + seeded route test (TDD)

**Files:** Create `src/lib/types/api.ts`, `src/app/api/metrics/npm/route.test.ts`; modify the 8 route files; possibly delete `src/lib/types/metrics.ts`

- [ ] **Step 1: Create `src/lib/types/api.ts`**

```ts
import type { EventCategory } from "./events";

/**
 * THE page ⇄ API-route contract. Every dashboard route annotates its GET
 * payload with a type from this module, and every page types its fetch
 * results with the same declarations — so a shape change on either side is a
 * compile error, not a blank chart. Existing shared domain types are
 * re-exported (referenced, never duplicated). Compile-time only by design.
 */

// Re-exported domain shapes (declared once in their home modules)
export type { TrackedEvent } from "./events";
export type {
  CompanySummary,
  CompanyDetail,
  FiredAlert,
  AlertRuleType,
} from "./sales-intelligence";

// ── /api/metrics/npm ────────────────────────────────────────────────────
export interface NpmPackageSummary {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
  growthPercent7d: number;
}
export interface DownloadRow {
  date: string;
  downloads: number;
}

// ── /api/metrics/pypi ───────────────────────────────────────────────────
export interface PypiPackageSummary {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
}
export interface PypiDownloadRow {
  date: string;
  downloads: number;
  categoryValue: string | null;
}

// ── /api/metrics/github ─────────────────────────────────────────────────
export interface GithubRepoSummary {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  contributors: number;
}
export interface GithubMetricRow {
  date: string;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  contributors: number | null;
}
export interface TrafficRow {
  date: string;
  total: number;
  unique: number;
}
export interface GithubRepoMetricsResponse {
  metrics?: GithubMetricRow[];
  clones?: TrafficRow[];
  views?: TrafficRow[];
}

// ── /api/metrics/dependencies ───────────────────────────────────────────
export interface DependencySummary {
  id: number;
  name: string;
  registry: string;
  displayName: string | null;
  dependentCount: number;
}
export interface DependencyCountRow {
  date: string;
  count: number;
}
export interface DependentRow {
  dependentName: string;
  dependentRegistry: string;
  dependentVersion: string | null;
  firstSeen: string;
}
export interface DependencyDetailResponse {
  counts: DependencyCountRow[];
  dependents: DependentRow[];
}

// ── /api/alerts/rules ───────────────────────────────────────────────────
export interface AlertRuleRow {
  id: number;
  name: string;
  description: string | null;
  ruleType: import("./sales-intelligence").AlertRuleType;
  config: string;
  enabled: number;
  notifySlack: number;
}

// ── /api/config ─────────────────────────────────────────────────────────
export interface TrackedRepoRow {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
}
export interface TrackedPackageRow {
  id: number;
  registry: string;
  name: string;
  displayName: string | null;
  repoId: number | null;
}
export interface ConfigResponse {
  repos: TrackedRepoRow[];
  packages: TrackedPackageRow[];
}

// ── /api/settings/slack ─────────────────────────────────────────────────
export interface SlackSettingsResponse {
  configured: boolean;
  channelName: string;
  enabled: boolean;
  webhookUrlSet: boolean;
}

/** Chart-annotation rows accepted by chart wrappers — a structural subset of
 *  TrackedEvent (description may be null from the API). */
export interface ChartEventRow {
  date: string;
  title: string;
  category: EventCategory;
  description?: string | null;
}
```

(During execution: verify field names against each route's actual select before finalising — e.g. confirm the alerts GET payload matches `FiredAlert`, and the github metric rows' nullability from schema. Adjust the CONTRACT to match reality, never the payloads.)

- [ ] **Step 2: Write the failing seeded route test — `src/app/api/metrics/npm/route.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { NpmPackageSummary, DownloadRow } from "@/lib/types/api";

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
  .prepare("INSERT INTO tracked_packages (registry, name, display_name) VALUES ('npm', 'demo-pkg', 'Demo')")
  .run();
const pkgId = (sqlite.prepare("SELECT id FROM tracked_packages WHERE name='demo-pkg'").get() as { id: number }).id;
// last-7-days window: 100/day; previous window (8-14 days ago): 50/day
const insert = sqlite.prepare("INSERT INTO npm_downloads (package_id, date, downloads) VALUES (?, ?, ?)");
for (let d = 1; d <= 6; d++) insert.run(pkgId, daysAgoIso(d), 100);
for (let d = 8; d <= 13; d++) insert.run(pkgId, daysAgoIso(d), 50);

describe("GET /api/metrics/npm (seeded temp DB)", () => {
  it("returns package summaries matching the contract, with windowed growth", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/npm"));
    const body = (await res.json()) as NpmPackageSummary[];

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    const summary = body[0];
    expect(summary.name).toBe("demo-pkg");
    expect(summary.displayName).toBe("Demo");
    expect(summary.downloadsLast7d).toBe(600);
    expect(summary.growthPercent7d).toBe(100); // 600 vs 300
    // contract keys exactly
    expect(Object.keys(summary).sort()).toEqual(
      ["displayName", "downloadsLast7d", "growthPercent7d", "id", "name"].sort()
    );
  });

  it("returns the time series for a packageId", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/metrics/npm?packageId=${pkgId}`)
    );
    const body = (await res.json()) as DownloadRow[];
    expect(body.length).toBe(12);
    expect(body[0]).toEqual({ date: daysAgoIso(13), downloads: 50 });
  });
});
```

(If `NextRequest` proves unconstructable under vitest, fall back to `new Request(url) as unknown as NextRequest` — the handler only touches `request.nextUrl.searchParams`; in that case switch the handler to `new URL(request.url).searchParams`, which is contract-neutral. Note: the prev-window boundary uses `lte(daysAgo(7))` so day 7 belongs to both windows — seed days 1–6 and 8–13 to keep the expectation exact.)

- [ ] **Step 3: Red** — `npx vitest run src/app/api/metrics/npm/route.test.ts` → FAIL (contract module missing / shapes unannotated).

- [ ] **Step 4: Annotate every route's GET payload**

Pattern (npm route summaries):
```ts
import type { NpmPackageSummary, DownloadRow } from "@/lib/types/api";
...
const summaries: NpmPackageSummary[] = packages.map((pkg) => { ... });
return NextResponse.json(summaries);
...
const data: DownloadRow[] = db.select({ date: ..., downloads: ... })...all();
return NextResponse.json(data);
```
Apply equivalents in: pypi (`PypiPackageSummary[]` / `PypiDownloadRow[]`), github (`GithubRepoSummary[]` / `GithubRepoMetricsResponse`), dependencies (`DependencySummary[]` / `DependencyDetailResponse`), events GET (`TrackedEvent[]`), companies (`CompanySummary[]`), companies/[id] (`CompanyDetail`), alerts GET (`FiredAlert[]`), alerts/rules GET (`AlertRuleRow[]`), config GET (`ConfigResponse`), settings/slack GET (`SlackSettingsResponse`). If a drizzle row type mismatches the contract (e.g. enum-typed columns), map explicitly rather than loosening the contract.

- [ ] **Step 5: Green** — `npm test && npm run build` → pass (build = the compile check of AC3).

- [ ] **Step 6: Check `src/lib/types/metrics.ts`** — `grep -rn "types/metrics" src/`; if unused, `git rm src/lib/types/metrics.ts`.

- [ ] **Step 7: Commit** — `git add -A src/lib/types src/app/api && git commit -m "feat: shared API contract types; routes annotate their payloads"`

---

### Task 4: Pages import the contract; delete local interfaces

**Files:** `src/app/page.tsx`, `src/app/github/page.tsx`, `src/app/npm/page.tsx`, `src/app/pypi/page.tsx`, `src/app/dependencies/page.tsx`, `src/app/events/page.tsx`, `src/app/alerts/page.tsx`, `src/app/settings/page.tsx`, `src/components/charts/TimeSeriesChart.tsx` (+ any other chart wrapper declaring an event row)

- [ ] **Step 1: Widen the chart event prop**

In TimeSeriesChart.tsx (and any sibling declaring the same), change `description?: string` in its local `ChartEvent` to `description?: string | null` (or replace the local interface with `import type { ChartEventRow } from "@/lib/types/api"`). Behaviour unchanged — rendering already guards with truthiness.

- [ ] **Step 2: Replace local interfaces per page** (delete the local declaration; import from `@/lib/types/api`; update usage names)

| Page | Delete local | Import instead |
|---|---|---|
| page.tsx | NpmSummary, GithubSummary, DepSummary, DownloadRow, EventRow | NpmPackageSummary, GithubRepoSummary, DependencySummary, DownloadRow, TrackedEvent |
| github/page.tsx | GithubRepo, MetricRow, TrafficRow, EventRow | GithubRepoSummary, GithubMetricRow, TrafficRow, TrackedEvent |
| npm/page.tsx | NpmPackage, DownloadRow, EventRow | NpmPackageSummary, DownloadRow, TrackedEvent |
| pypi/page.tsx | PypiPackage, DownloadRow, EventRow | PypiPackageSummary, PypiDownloadRow, TrackedEvent |
| dependencies/page.tsx | DepSummary, DepCount, Dependent | DependencySummary, DependencyCountRow, DependentRow |
| events/page.tsx | TrackedEvent (local) | TrackedEvent |
| alerts/page.tsx | AlertRule (local) | AlertRuleRow |
| settings/page.tsx | TrackedRepo, TrackedPackage | TrackedRepoRow, TrackedPackageRow |

Where a renamed type is referenced (state generics, props), update the reference; where the home page used the narrower GithubSummary/DepSummary, the full contract type is a superset — no behaviour change.

- [ ] **Step 3: AC2 verification + compile**

```bash
grep -rn "^interface \|^  interface " src/app --include="page.tsx" | grep -v node_modules
npm run build
```
Expected: no API-response-shape interfaces remain in pages (UI-only prop/state interfaces unrelated to API responses are fine if any exist); build passes.

- [ ] **Step 4: Run everything** — `npm test` → green.
- [ ] **Step 5: Commit** — `git add -u src/ && git commit -m "refactor: pages consume the shared API contract; local response interfaces deleted"`

---

### Task 5: CLAUDE.md + AC sweep + PR

- [ ] **Step 1: CLAUDE.md** — In the Conventions section, replace the dates bullet with:

```markdown
- Dates: ISO `YYYY-MM-DD` text everywhere; ALL date formatting/windows/growth go through `src/lib/dates.ts` (`toIsoDate`/`todayIso`/`daysAgoIso`/`growthPercent` — never inline `.toISOString().split`). Daily metric tables have a unique `(entityId, date)` index and collectors upsert on it.
- API contract: `src/lib/types/api.ts` declares every dashboard route's GET payload; routes annotate their payload consts with it and pages import the same types — never declare a response shape locally.
```

- [ ] **Step 2: AC sweep**

```bash
grep -rn 'toISOString().split' src/ | grep -v "src/lib/dates.ts"      # AC1 → empty
grep -rn "getDateDaysAgo" src/                                         # AC1 → empty
npm test                                                               # AC4
npm run build                                                          # AC5 (compile check = AC3/AC6-story)
npx eslint src/lib src/app/api                                         # no NEW problems
```
Plus AC3 by inspection: open each route file and confirm the payload const is annotated.

- [ ] **Step 3: Commit docs + plan, push, PR** (note in PR: the 5 pre-existing page lint errors are deliberately untouched — metric-page-shell PRD scope).

---

## Self-Review Notes

- **Spec coverage:** Story 1/2/6 → Task 3 (contract + annotations + build-enforced); Story 3 → daysAgoIso everywhere (Task 2); Story 4 → growthPercent (Tasks 1–2); Story 5 → collectors migrated (Task 2); AC1 → Task 2 Step 4 + Task 5; AC2 → Task 4; AC3 → Task 3 Step 4 + build; AC4 → Tasks 1+3 tests; AC5 → Task 5.
- **Semantics preserved:** growth zero-previous→0; npm windows unchanged (incl. the day-7 double-count quirk — NOT fixed, out of scope: "no payload semantics change"); npm collector still collects "yesterday"; companies scoreTrend window unchanged.
- **Honest deviations:** none structural; ChartEvent widening is a prop-type relaxation with no runtime change; `types/metrics.ts` deletion is conditional on it being unused.
- **Type consistency:** names in Task 3's module match Task 4's table and the route annotations verbatim.
