# Competitor Compare Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in competitive benchmarking on the GitHub/npm/PyPI metric pages (GitHub issue #20, parent PRD #17): a "Compare" toggle overlays competitor series (stars / downloads over time) labeled by competitor name; default views stay own-only.

**Architecture:** The three metric list routes gain a `?competitors=1` view returning competitor-attributed entity summaries (one shared contract shape, `CompetitorEntitySummary`); the per-id series paths (deliberately left unguarded in #18) provide the data. A new pure transform module (`src/components/metric-page/compare.ts` — exported, unit-tested) builds series keys/labels/colors and merges N competitor series into recharts-friendly rows; a new client hook (`use-competitor-compare.ts`, mirroring `use-metric-page.ts` conventions: keyed state, derived status, no silent catches, module-level configs) owns toggle + fetch flow. `useMetricPage` additionally exposes `buildQueryString` (it already owns the single `useDashboardFilters` instance — the filters hook is local state per call, so the compare hook must NOT call it again).

**Tech Stack:** Next.js client components, recharts via the existing `TimeSeriesChart` (already multi-series via its `metrics` array), Vitest for transforms + route tests.

**Key facts pinned:**
- `useDashboardFilters` is per-call local state → compare hook receives `dateRange` + `buildQueryString` from the page's single `useMetricPage` call; exposing `buildQueryString` from the shell hook is a 1-line additive change.
- Chart palette: own series use `--chart-1`/`--chart-2`; competitor overlays cycle `--chart-3`, `--chart-5`, `--chart-4` (4 is the lightest — last in cycle). Overlays are always `type: "line"` to read against own area/bar.
- npm aggregation (weekly/monthly) must apply to competitor series too — the page reuses the existing tested `aggregateWeekly`/`aggregateMonthly` on competitor rows before merging (map `{date,value}` ⇄ `{date,downloads}` at the call site).
- pypi competitor series sum across `categoryValue` mirrors via the existing `aggregateByDate` (inside the page config's `toRows`).
- GitHub overlay = stars only (the issue names "stars over time"); series fetched with `metric=stars`.
- No Switch component exists — the toggle is a small `Button` (`outline` ↔ `default`) labeled "Compare".
- Dependencies page is NOT in scope (issue lists GitHub/npm/PyPI).
- github metrics collector already tolerates competitor-repo traffic 403s (per-endpoint try/catch) — no collector change.
- No component-test infra: toggle interactivity is covered by transform unit tests + route tests + SSR smoke (the rendered page HTML contains the Compare button) + demo; visual confirmation noted for Will.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-competitor-compare-toggle.md` | Create | This plan |
| `src/lib/types/api.ts` | Modify | `CompetitorEntitySummary` |
| `src/app/api/metrics/npm/route.ts` + `.test.ts` | Modify | `?competitors=1` view + tests |
| `src/app/api/metrics/pypi/route.ts` + `.test.ts` | Modify | Same |
| `src/app/api/metrics/github/route.ts` + `.test.ts` | Modify | Same (name = `owner/name`) |
| `src/components/metric-page/compare.ts` + `.test.ts` | Create | Pure: keys, labels, colors, `mergeCompareRows` |
| `src/components/metric-page/use-competitor-compare.ts` | Create | Client hook: toggle + keyed fetch flow |
| `src/components/metric-page/use-metric-page.ts` | Modify | Expose `buildQueryString` |
| `src/app/npm/page.tsx`, `src/app/pypi/page.tsx`, `src/app/github/page.tsx` | Modify | Toggle + overlay wiring |
| `CLAUDE.md` | Modify | Compare conventions sentence |

---

### Task 1: Branch + commit the plan

- [ ] **Step 1:**

```bash
git checkout -b feat/competitor-compare
git add docs/superpowers/plans/2026-06-03-competitor-compare-toggle.md
git commit -m "docs: implementation plan for competitor compare toggle (#20)"
```

---

### Task 2: Contract type + `?competitors=1` on the npm route

**Files:**
- Modify: `src/lib/types/api.ts` (after the dependencies section)
- Modify: `src/app/api/metrics/npm/route.ts`
- Test: `src/app/api/metrics/npm/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing describe in `src/app/api/metrics/npm/route.test.ts`:

```ts
  it("lists competitor packages (with competitor name) under ?competitors=1", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/npm?competitors=1"));
    const body = (await res.json()) as CompetitorEntitySummary[];
    expect(body).toEqual([
      { id: rivalId, name: "rival-pkg", displayName: "Rival", competitor: "Acme" },
    ]);
  });
```

and add `CompetitorEntitySummary` to the type import line:

```ts
import type { NpmPackageSummary, DownloadRow, CompetitorEntitySummary } from "@/lib/types/api";
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/npm/route.test.ts`
Expected: FAIL — the param is ignored; the guarded own-list (without rival-pkg) comes back.

- [ ] **Step 3: Implement — contract type + route branch**

In `src/lib/types/api.ts`, after the `/api/metrics/dependencies` section:

```ts
// ── ?competitors=1 view (github/npm/pypi list endpoints) ────────────────
/** Competitor-attributed entities for the compare overlay. The default list
 *  paths exclude these (the totals guard); this opt-in view exposes them with
 *  their competitor name for labeling. Series come from the existing
 *  per-id detail paths, which intentionally serve competitor entities. */
export interface CompetitorEntitySummary {
  id: number;
  /** Repo as "owner/name"; package as registry name. */
  name: string;
  displayName: string | null;
  competitor: string;
}
```

In `src/app/api/metrics/npm/route.ts`: import the type —

```ts
import type { NpmPackageSummary, DownloadRow, CompetitorEntitySummary } from "@/lib/types/api";
```

and add `isNotNull` to the drizzle import:

```ts
import { eq, and, gte, lte, sql, desc, isNull, isNotNull } from "drizzle-orm";
```

then insert the competitors branch right after `const db = getDb();`:

```ts
  // Opt-in compare view: competitor-attributed packages with their label.
  if (!packageId && searchParams.get("competitors") === "1") {
    const rows = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "npm"), isNotNull(trackedPackages.competitor)))
      .all();
    const payload: CompetitorEntitySummary[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      competitor: p.competitor!,
    }));
    return NextResponse.json(payload);
  }
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/metrics/npm/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/api.ts src/app/api/metrics/npm/route.ts src/app/api/metrics/npm/route.test.ts
git commit -m "feat: npm metrics exposes competitor packages under ?competitors=1"
```

---

### Task 3: `?competitors=1` on the pypi route

**Files:**
- Modify: `src/app/api/metrics/pypi/route.ts`
- Test: `src/app/api/metrics/pypi/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing describe in `src/app/api/metrics/pypi/route.test.ts` (and add `CompetitorEntitySummary` to its api-types import):

```ts
  it("lists competitor packages (with competitor name) under ?competitors=1", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metrics/pypi?competitors=1"));
    const body = (await res.json()) as CompetitorEntitySummary[];
    expect(body).toEqual([
      { id: rivalId, name: "rival-pkg", displayName: "Rival", competitor: "Acme" },
    ]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/pypi/route.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `src/app/api/metrics/pypi/route.ts`: imports —

```ts
import { eq, and, gte, lte, sql, isNull, isNotNull } from "drizzle-orm";
import type { PypiPackageSummary, PypiDownloadRow, CompetitorEntitySummary } from "@/lib/types/api";
```

branch after `const db = getDb();`:

```ts
  // Opt-in compare view: competitor-attributed packages with their label.
  if (!packageId && searchParams.get("competitors") === "1") {
    const rows = db
      .select()
      .from(trackedPackages)
      .where(and(eq(trackedPackages.registry, "pypi"), isNotNull(trackedPackages.competitor)))
      .all();
    const payload: CompetitorEntitySummary[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      competitor: p.competitor!,
    }));
    return NextResponse.json(payload);
  }
```

- [ ] **Step 4: Verify green, commit**

```bash
npx vitest run src/app/api/metrics/pypi/route.test.ts
git add src/app/api/metrics/pypi/route.ts src/app/api/metrics/pypi/route.test.ts
git commit -m "feat: pypi metrics exposes competitor packages under ?competitors=1"
```

---

### Task 4: `?competitors=1` on the github route

**Files:**
- Modify: `src/app/api/metrics/github/route.ts`
- Test: `src/app/api/metrics/github/route.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the describe in `src/app/api/metrics/github/route.test.ts` (and add `CompetitorEntitySummary` to its api-types import):

```ts
  it("lists competitor repos (owner/name + competitor) under ?competitors=1", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/metrics/github?competitors=1")
    );
    const body = (await res.json()) as CompetitorEntitySummary[];
    expect(body).toEqual([
      { id: theirId, name: "them/their-repo", displayName: "Theirs", competitor: "Acme" },
    ]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/metrics/github/route.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `src/app/api/metrics/github/route.ts`: imports —

```ts
import type {
  GithubRepoSummary,
  GithubRepoMetricsResponse,
  CompetitorEntitySummary,
} from "@/lib/types/api";
import { eq, and, gte, lte, desc, isNull, isNotNull } from "drizzle-orm";
```

branch after `const db = getDb();`:

```ts
  // Opt-in compare view: competitor-attributed repos with their label.
  if (!repoId && searchParams.get("competitors") === "1") {
    const rows = db
      .select()
      .from(trackedRepos)
      .where(isNotNull(trackedRepos.competitor))
      .all();
    const payload: CompetitorEntitySummary[] = rows.map((r) => ({
      id: r.id,
      name: `${r.owner}/${r.name}`,
      displayName: r.displayName,
      competitor: r.competitor!,
    }));
    return NextResponse.json(payload);
  }
```

- [ ] **Step 4: Verify green, commit**

```bash
npx vitest run src/app/api/metrics/github/route.test.ts
git add src/app/api/metrics/github/route.ts src/app/api/metrics/github/route.test.ts
git commit -m "feat: github metrics exposes competitor repos under ?competitors=1"
```

---

### Task 5: Pure compare transforms

**Files:**
- Create: `src/components/metric-page/compare.ts`, `src/components/metric-page/compare.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/metric-page/compare.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  competitorSeriesKey,
  competitorLabel,
  competitorColor,
  mergeCompareRows,
  type CompareSeries,
} from "./compare";

describe("compare transforms", () => {
  it("builds stable series keys and competitor-prefixed labels", () => {
    expect(competitorSeriesKey(7)).toBe("competitor_7");
    expect(
      competitorLabel({ id: 7, name: "rival-pkg", displayName: "Rival", competitor: "Acme" })
    ).toBe("Acme — Rival");
    expect(
      competitorLabel({ id: 8, name: "them/repo", displayName: null, competitor: "Acme" })
    ).toBe("Acme — them/repo");
  });

  it("cycles overlay colors through chart-3/5/4", () => {
    expect(competitorColor(0)).toBe("var(--chart-3)");
    expect(competitorColor(1)).toBe("var(--chart-5)");
    expect(competitorColor(2)).toBe("var(--chart-4)");
    expect(competitorColor(3)).toBe("var(--chart-3)");
  });

  it("merges competitor series onto own rows by date, keeps disjoint dates, sorts ascending", () => {
    const own = [
      { date: "2026-06-01", downloads: 10 },
      { date: "2026-06-03", downloads: 30 },
    ];
    const series: CompareSeries[] = [
      {
        key: "competitor_7",
        label: "Acme — Rival",
        color: "var(--chart-3)",
        rows: [
          { date: "2026-06-01", value: 5 },
          { date: "2026-06-02", value: 6 },
        ],
      },
    ];
    expect(mergeCompareRows(own, series)).toEqual([
      { date: "2026-06-01", downloads: 10, competitor_7: 5 },
      { date: "2026-06-02", competitor_7: 6 },
      { date: "2026-06-03", downloads: 30 },
    ]);
  });

  it("returns own rows untouched for an empty series list", () => {
    const own = [{ date: "2026-06-01", downloads: 10 }];
    expect(mergeCompareRows(own, [])).toEqual(own);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/metric-page/compare.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/components/metric-page/compare.ts`:

```ts
import type { CompetitorEntitySummary } from "@/lib/types/api";

/** Pure overlay math for the competitor compare toggle — exported and
 *  unit-tested per the metric-page conventions. The hook
 *  (use-competitor-compare.ts) owns fetching; pages own page-specific
 *  aggregation (npm weekly/monthly reuses its own tested transforms). */

export interface CompareRow {
  date: string;
  value: number;
}

export interface CompareSeries {
  /** Chart dataKey — stable per entity. */
  key: string;
  /** Legend label, competitor-first. */
  label: string;
  color: string;
  rows: CompareRow[];
}

export function competitorSeriesKey(id: number): string {
  return `competitor_${id}`;
}

export function competitorLabel(e: CompetitorEntitySummary): string {
  return `${e.competitor} — ${e.displayName || e.name}`;
}

/** Own series hold chart-1/2; overlays cycle the rest (4 is the lightest —
 *  last in the cycle). */
const OVERLAY_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)"];
export function competitorColor(index: number): string {
  return OVERLAY_COLORS[index % OVERLAY_COLORS.length];
}

/** Merge competitor series onto the page's own chart rows: one row per date
 *  carrying the own keys plus one key per competitor series. Dates missing on
 *  either side stay absent from that row (recharts skips them); the result is
 *  date-ascending. */
export function mergeCompareRows(
  own: Array<Record<string, string | number>>,
  series: CompareSeries[]
): Array<Record<string, string | number>> {
  if (series.length === 0) return own;
  const byDate = new Map<string, Record<string, string | number>>();
  for (const row of own) byDate.set(String(row.date), { ...row });
  for (const s of series) {
    for (const { date, value } of s.rows) {
      const row = byDate.get(date) ?? { date };
      row[s.key] = value;
      byDate.set(date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
```

- [ ] **Step 4: Verify green, commit**

```bash
npx vitest run src/components/metric-page/compare.test.ts
git add src/components/metric-page/compare.ts src/components/metric-page/compare.test.ts
git commit -m "feat: pure compare-overlay transforms (keys, labels, colors, row merge)"
```

---

### Task 6: Compare hook + shell hook exposes buildQueryString

**Files:**
- Create: `src/components/metric-page/use-competitor-compare.ts`
- Modify: `src/components/metric-page/use-metric-page.ts` (return object)

No unit test (hooks aren't component-tested in this repo — same as `use-metric-page`); covered by lint/build + pages + demo.

- [ ] **Step 1: Expose buildQueryString from useMetricPage**

In `src/components/metric-page/use-metric-page.ts`, the return object gains one line:

```ts
  return {
    entities,
    selected,
    setSelected,
    current,
    detail: currentDetail,
    status,
    error: activeError,
    retry,
    dateRange,
    setDateRange,
    persona,
    setPersona,
    buildQueryString,
  };
```

- [ ] **Step 2: Create the hook**

Create `src/components/metric-page/use-competitor-compare.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "./use-metric-page";
import {
  competitorSeriesKey,
  competitorLabel,
  competitorColor,
  type CompareRow,
  type CompareSeries,
} from "./compare";
import type { CompetitorEntitySummary } from "@/lib/types/api";

export interface CompetitorCompareConfig {
  /** The ?competitors=1 list view for this page's registry. */
  listUrl: string;
  /** Per-entity series URL (the unguarded detail-by-id path). */
  seriesUrl: (id: number, qs: (extra?: Record<string, string>) => string) => string;
  /** Map the raw series response to {date,value} rows. */
  toRows: (raw: unknown) => CompareRow[];
}

/**
 * The compare-toggle data flow, mirroring use-metric-page conventions: keyed
 * state (toggle + date range), derived loading, explicit error, no silent
 * catches. Configs must be module-level constants. Receives dateRange +
 * buildQueryString from the page's single useMetricPage call —
 * useDashboardFilters is per-call local state and must not be re-invoked.
 */
export function useCompetitorCompare(
  config: CompetitorCompareConfig,
  dateRange: string,
  buildQueryString: (extra?: Record<string, string>) => string
) {
  const [enabled, setEnabled] = useState(false);
  const [data, setData] = useState<{ key: string; series: CompareSeries[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const key = dateRange;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const entities = await fetchJson<CompetitorEntitySummary[]>(config.listUrl);
        const series = await Promise.all(
          entities.map(
            async (e, i): Promise<CompareSeries> => ({
              key: competitorSeriesKey(e.id),
              label: competitorLabel(e),
              color: competitorColor(i),
              rows: config.toRows(await fetchJson<unknown>(config.seriesUrl(e.id, buildQueryString))),
            })
          )
        );
        if (!cancelled) setData({ key, series });
      } catch (err: unknown) {
        if (!cancelled) {
          setError({ key, message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, key, buildQueryString, config]);

  const series = enabled && data?.key === key ? data.series : [];
  const activeError = enabled && error?.key === key ? error.message : null;
  const loading = enabled && !activeError && data?.key !== key;

  return { enabled, setEnabled, series, loading, error: activeError };
}
```

- [ ] **Step 3: Lint + targeted suites**

```bash
npm run lint
npx vitest run src/components/metric-page/
```
Expected: lint clean (4 pre-existing warnings), compare tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/metric-page/use-competitor-compare.ts src/components/metric-page/use-metric-page.ts
git commit -m "feat: competitor-compare hook; shell hook exposes buildQueryString"
```

---

### Task 7: npm page toggle + overlay

**Files:**
- Modify: `src/app/npm/page.tsx`

- [ ] **Step 1: Wire the page**

(a) Imports:

```ts
import { Button } from "@/components/ui/button";
import { useCompetitorCompare, type CompetitorCompareConfig } from "@/components/metric-page/use-competitor-compare";
import { mergeCompareRows, type CompareRow } from "@/components/metric-page/compare";
```

(b) Module-level config (below `CONFIG`):

```ts
const COMPARE_CONFIG: CompetitorCompareConfig = {
  listUrl: "/api/metrics/npm?competitors=1",
  seriesUrl: (id, qs) => `/api/metrics/npm?${qs({ packageId: String(id) })}`,
  toRows: (raw) => (raw as DownloadRow[]).map((d) => ({ date: d.date, value: d.downloads })),
};
```

(c) Inside the component, after `const [aggregation, setAggregation] = useState("daily");`:

```ts
  const compare = useCompetitorCompare(COMPARE_CONFIG, page.dateRange, page.buildQueryString);

  // Competitor rows follow the same aggregation as our own series.
  const aggregateCompare = (rows: CompareRow[]): CompareRow[] => {
    if (aggregation === "daily") return rows;
    const asDownloads = rows.map((r) => ({ date: r.date, downloads: r.value }));
    const agg = aggregation === "weekly" ? aggregateWeekly(asDownloads) : aggregateMonthly(asDownloads);
    return agg.map((r) => ({ date: String(r.date), value: Number(r.downloads) }));
  };
  const compareSeries = compare.series.map((s) => ({ ...s, rows: aggregateCompare(s.rows) }));
  const mergedData = mergeCompareRows(displayData, compareSeries);
```

(d) Chart card header — add the toggle next to the Tabs (the flex row already exists):

```tsx
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={compare.enabled ? "default" : "outline"}
                onClick={() => compare.setEnabled(!compare.enabled)}
              >
                Compare
              </Button>
              <Tabs defaultValue="daily">
                ...existing TabsList unchanged...
              </Tabs>
            </div>
```

(e) Chart: `data={mergedData}` and metrics gains the overlay lines:

```tsx
          <TimeSeriesChart
            data={mergedData}
            metrics={[
              {
                key: "downloads",
                label: "Downloads",
                color: "var(--chart-1)",
                type: aggregation === "daily" ? "area" : "bar",
              },
              ...compareSeries.map((s) => ({
                key: s.key,
                label: s.label,
                color: s.color,
                type: "line" as const,
              })),
            ]}
            events={page.detail?.events}
            height={400}
          />
```

(f) Under the chart header (inside the card, before the chart), compare status lines:

```tsx
          {compare.error && (
            <p className="text-sm text-destructive mb-2">Compare failed: {compare.error}</p>
          )}
          {compare.enabled && !compare.loading && !compare.error && compare.series.length === 0 && (
            <p className="text-sm text-muted-foreground mb-2">
              No competitor packages tracked. Add one in Settings with a competitor name.
            </p>
          )}
```

- [ ] **Step 2: Verify**

```bash
npm run lint && npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/npm/page.tsx
git commit -m "feat: npm page compare toggle overlays competitor download series"
```

---

### Task 8: pypi page toggle + overlay

**Files:**
- Modify: `src/app/pypi/page.tsx`

- [ ] **Step 1: Wire the page**

(a) Imports (as npm, plus the page's own transform already imported):

```ts
import { Button } from "@/components/ui/button";
import { useCompetitorCompare, type CompetitorCompareConfig } from "@/components/metric-page/use-competitor-compare";
import { mergeCompareRows } from "@/components/metric-page/compare";
```

(b) Module-level config:

```ts
const COMPARE_CONFIG: CompetitorCompareConfig = {
  listUrl: "/api/metrics/pypi?competitors=1",
  seriesUrl: (id, qs) => `/api/metrics/pypi?${qs({ packageId: String(id) })}`,
  // Sum across categoryValue mirrors exactly like the own series does.
  toRows: (raw) =>
    aggregateByDate(raw as PypiDownloadRow[]).map((d) => ({ date: d.date, value: d.downloads })),
};
```

(c) In the component:

```ts
  const compare = useCompetitorCompare(COMPARE_CONFIG, page.dateRange, page.buildQueryString);
  const mergedData = mergeCompareRows(aggregated, compare.series);
```

(d) Chart card header gains the toggle (wrap the heading row in a flex container):

```tsx
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Downloads - {page.current?.displayName || page.current?.name}
            </h3>
            <Button
              size="sm"
              variant={compare.enabled ? "default" : "outline"}
              onClick={() => compare.setEnabled(!compare.enabled)}
            >
              Compare
            </Button>
          </div>
```

(plus the same error/empty compare notices as the npm page)

(e) Chart: `data={mergedData}`, metrics = own series + `...compare.series.map((s) => ({ key: s.key, label: s.label, color: s.color, type: "line" as const }))`.

- [ ] **Step 2: Verify + commit**

```bash
npm run lint && npm run build
git add src/app/pypi/page.tsx
git commit -m "feat: pypi page compare toggle overlays competitor download series"
```

---

### Task 9: github page toggle + overlay (stars)

**Files:**
- Modify: `src/app/github/page.tsx`

- [ ] **Step 1: Wire the page**

(a) Imports:

```ts
import { Button } from "@/components/ui/button";
import { useCompetitorCompare, type CompetitorCompareConfig } from "@/components/metric-page/use-competitor-compare";
import { mergeCompareRows } from "@/components/metric-page/compare";
```

(b) Module-level config:

```ts
const COMPARE_CONFIG: CompetitorCompareConfig = {
  listUrl: "/api/metrics/github?competitors=1",
  seriesUrl: (id, qs) => `/api/metrics/github?${qs({ repoId: String(id), metric: "stars" })}`,
  toRows: (raw) =>
    ((raw as GithubRepoMetricsResponse).metrics ?? []).map((m) => ({
      date: m.date,
      value: m.stars ?? 0,
    })),
};
```

(c) In the component:

```ts
  const compare = useCompetitorCompare(COMPARE_CONFIG, page.dateRange, page.buildQueryString);
  const starsData = metricsData.map((d) => ({
    date: d.date,
    stars: d.stars ?? 0,
    forks: d.forks ?? 0,
  }));
  const mergedStars = mergeCompareRows(starsData, compare.series);
```

(d) "Stars Over Time" card header gains the toggle:

```tsx
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">Stars Over Time</h3>
            <Button
              size="sm"
              variant={compare.enabled ? "default" : "outline"}
              onClick={() => compare.setEnabled(!compare.enabled)}
            >
              Compare
            </Button>
          </div>
```

(plus the same error/empty compare notices)

(e) Chart: `data={mergedStars}`, metrics = stars/forks + overlay lines (same map as the other pages). Clones/Views cards unchanged (traffic isn't collectable for competitor repos).

- [ ] **Step 2: Verify + commit**

```bash
npm run lint && npm run build
git add src/app/github/page.tsx
git commit -m "feat: github page compare toggle overlays competitor star series"
```

---

### Task 10: CLAUDE.md conventions

- [ ] **Step 1:** Append to the metric-page shell sentence in the Architecture section (dashboard half), after "Page-specific math lives in exported, unit-tested transforms (e.g. `src/app/npm/aggregate.ts`).":

```markdown
The competitor compare toggle follows the same split: pure overlay math in
`src/components/metric-page/compare.ts` (tested), fetch flow in
`use-competitor-compare.ts` (module-level config, keyed state, explicit
error), competitor entities via the list endpoints' `?competitors=1` view +
the unguarded detail-by-id series paths.
```

- [ ] **Step 2:**

```bash
git add CLAUDE.md
git commit -m "docs: compare-toggle conventions in CLAUDE.md"
```

---

### Task 11: Full verification + demo

The issue's demo: *toggle compare on the npm page — competitor lines appear; toggle off — vanish, totals untouched.* Automated equivalent (no component tests by convention): route-level assertions on a seeded DB copy + SSR smoke that the page ships the toggle; visual click-through noted for Will.

- [ ] **Step 1: Full suite, lint, build**

```bash
npm test && npm run lint && npm run build
```

- [ ] **Step 2: Demo on a DB copy**

```bash
cp data/gtm-tracker.db /tmp/demo20.db
DATABASE_PATH=/tmp/demo20.db npm run db:migrate
sqlite3 /tmp/demo20.db "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'demo-rival-sdk', 'Rival SDK', 'DemoRival');"
RIVAL_ID=$(sqlite3 /tmp/demo20.db "SELECT id FROM tracked_packages WHERE name='demo-rival-sdk';")
sqlite3 /tmp/demo20.db "INSERT INTO npm_downloads (package_id, date, downloads) VALUES ($RIVAL_ID, date('now','-2 days'), 5000), ($RIVAL_ID, date('now','-1 days'), 5200);"
DATABASE_PATH=/tmp/demo20.db npm run dev   # background
# default list unchanged (no rival):
curl -s localhost:3000/api/metrics/npm | python3 -c "import json,sys; print([p['name'] for p in json.load(sys.stdin)])"
# compare view exposes it, labeled:
curl -s "localhost:3000/api/metrics/npm?competitors=1" | python3 -m json.tool
# series available by id:
curl -s "localhost:3000/api/metrics/npm?packageId=$RIVAL_ID" | python3 -m json.tool
# SSR smoke: the page ships the Compare toggle
curl -s localhost:3000/npm | grep -o "Compare" | head -1
```
Expected: default list has no `demo-rival-sdk`; compare view returns it with `"competitor": "DemoRival"`; series returns the 2 rows; the npm page HTML contains "Compare".

- [ ] **Step 3: Teardown**

```bash
# stop dev server
rm -f /tmp/demo20.db /tmp/demo20.db-wal /tmp/demo20.db-shm
git status   # clean
```

---

### Task 12: PR + merge (standing authorization)

- [ ] **Step 1:** Push, `gh pr create` with the per-AC table (4 ACs), noting: shared `CompetitorEntitySummary` shape; github overlay = stars only; npm aggregation applied to overlays; visual toggle click-through left to Will (no component-test infra); colors cycle chart-3/5/4.

- [ ] **Step 2:** `gh pr merge --merge --delete-branch`, confirm issue #20 auto-closed.

---

## Self-Review

1. **AC coverage:** competitor series exposed separately + contract-declared → Tasks 2–4 (`CompetitorEntitySummary`, `?competitors=1`); toggle overlays labeled by competitor → Tasks 7–9 (`competitorLabel` = "Competitor — Entity"); default views/totals clean → guard untouched, route tests from #18 still assert exclusion, demo re-checks; overlay math exported + unit-tested → Task 5; shell conventions → module-level configs, keyed state, explicit error (Task 6 hook mirrors use-metric-page).
2. **Placeholder scan:** Task 7(d) says "...existing TabsList unchanged..." — that is an explicit keep-as-is instruction for surrounding code, not missing content; all new code is fully written.
3. **Type consistency:** `CompareRow`/`CompareSeries` shapes match between compare.ts, the hook, and pages; `competitor_${id}` keys match `competitorSeriesKey`; `buildQueryString` signature `(extra?: Record<string, string>) => string` matches `use-dashboard-filters`.
