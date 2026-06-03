# Metric Page Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four metric pages (GitHub, npm, PyPI, dependencies) into one deep page shell — a hook owning fetch/selection/filter/status flow plus a layout owning chrome and loading/error/empty states — so each page becomes a declaration (GitHub issue #10).

**Architecture:** `src/components/metric-page/use-metric-page.ts` is the data hook: list fetch → auto-select first → parallel detail fetches keyed on `selection|dateRange` → status union `loading | error | empty | ready`. Status is **derived** from keyed state (no synchronous setState in effects — this kills the 5 pre-existing `react-hooks/set-state-in-effect` lint errors). `MetricPageShell.tsx` renders Header+filters, entity selector, a declarative card grid, and the shared state UI (explicit error state with retry — no silent catches). Pages declare a module-level config (list URL, detail URLs, combine) + a cards array + chart children. npm's weekly/monthly and pypi's category aggregations become exported pure transforms with Vitest tests.

**Tech Stack:** React 19 client components, the API contract types from PRD #9, Vitest for pure transforms only (no component-test infra per PRD).

**Key facts pinned (preserve exactly — story 3: "the change is invisible"):**
- Card formulas: npm `Total in Period = Σ chartData.downloads` (raw daily rows, NOT aggregated); pypi `Total in Period = Σ aggregated.downloads`; deps `New This Month = dependents where firstSeen >= now-30d`; github cards read summary fields directly.
- Events fetches: github passes `repoId`; npm/pypi pass date filters only; dependencies fetches **no** events.
- Persona gating: github cards/charts via showMarketing/showEngineering; npm/pypi/deps don't gate.
- npm chart type: `area` for daily, `bar` for weekly/monthly. pypi sums across categoryValue mirrors and sorts by date.
- **Fix en passant** (regression from PRD #9's rename): dependencies chart heading "DependentRow Count Over Time" → "Dependent Count Over Time".
- Overview: PRD says reuse "where applicable" — its 4-parallel-list shape doesn't fit the entity hook; it reuses `fetchJson` + the shell's error-state UI, gains an explicit error state with retry, and the dead sparkline path (`data={[]}`) is removed (SparklineCard → MetricCard for the Package Overview grid; delete SparklineCard component if then unused).
- AC6 requires `npm run lint` to pass → the one remaining error after the refactor lives in the (out-of-scope) events page; apply the **minimal** compliant restructuring of its single effect, nothing more.
- Verification (per PRD): no component tests. Build + lint + transform unit tests + dev-server smoke (pages return 200, API payloads byte-identical since routes untouched) + code-level parity of card formulas; visual spot-check belongs to the human before merge — say so in the PR.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/metric-page/use-metric-page.ts` | Create | Hook: list/selection/detail/status + `fetchJson` (exported) |
| `src/components/metric-page/MetricPageShell.tsx` | Create | Layout: Header, selector, card grid, error/loading/empty states, `EmptyNotice` |
| `src/app/npm/aggregate.ts` + `.test.ts` | Create | aggregateWeekly/aggregateMonthly (moved) + tests |
| `src/app/pypi/aggregate.ts` + `.test.ts` | Create | aggregateByDate (moved) + tests |
| `src/app/dependencies/DependentsTable.tsx` | Create | The dependents table (extracted) |
| `src/app/{npm,pypi,github,dependencies}/page.tsx` | Rewrite | Declaration + shell call (~≤100 lines each) |
| `src/app/page.tsx` | Modify | fetchJson + error state; dead sparkline path removed |
| `src/components/charts/SparklineCard.tsx` | Delete if unused | Dead after overview change |
| `src/app/events/page.tsx` | Minimal fix | Lint-compliant effect (AC6 only) |
| `CLAUDE.md` | Modify | Shell conventions |

---

### Task 1: The hook

**Files:** Create `src/components/metric-page/use-metric-page.ts`

- [ ] **Step 1: Implement**

```ts
"use client";

import { useEffect, useState } from "react";
import { useDashboardFilters, type Persona } from "@/lib/hooks/use-dashboard-filters";

export type ShellStatus = "loading" | "error" | "empty" | "ready";

/** Fetch JSON or throw — no silent catches anywhere in the shell. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json() as Promise<T>;
}

export interface MetricPageConfig<D> {
  /** Endpoint returning the entity list. */
  listUrl: string;
  /** Detail endpoints for the selected entity (fetched in parallel). */
  detailUrls: (
    selectedId: string,
    qs: (extra?: Record<string, string>) => string
  ) => string[];
  /** Combine the parallel detail responses into one detail value. */
  combineDetail: (responses: unknown[]) => D;
}

/**
 * THE data flow for a metric page: fetch entity list → auto-select the first
 * entity → fetch its detail (re-keyed on selection + date range) → expose one
 * status union. Status is DERIVED from keyed state, so effects never call
 * setState synchronously and stale responses are ignored by key mismatch.
 * Any fetch failure surfaces as status "error" with a retry affordance.
 *
 * Configs must be module-level constants (stable references) — they appear in
 * effect dependency arrays.
 */
export function useMetricPage<E extends { id: number }, D>(config: MetricPageConfig<D>) {
  const { dateRange, setDateRange, persona, setPersona, buildQueryString } =
    useDashboardFilters();

  const [entities, setEntities] = useState<E[] | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{ key: string; data: D } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const detailKey = `${selected}|${dateRange}`;

  // Entity list
  useEffect(() => {
    let cancelled = false;
    fetchJson<E[]>(config.listUrl)
      .then((data) => {
        if (cancelled) return;
        setEntities(data);
        if (data.length > 0) setSelected((cur) => cur || String(data[0].id));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError({ key: "list", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, retryToken]);

  // Detail for the selected entity
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const key = `${selected}|${dateRange}`;
    Promise.all(config.detailUrls(selected, buildQueryString).map((u) => fetchJson<unknown>(u)))
      .then((responses) => {
        if (!cancelled) setDetail({ key, data: config.combineDetail(responses) });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError({ key, message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, dateRange, buildQueryString, config, retryToken]);

  const activeError =
    error && (error.key === "list" || error.key === detailKey) ? error.message : null;
  const currentDetail = detail && detail.key === detailKey ? detail.data : null;

  const status: ShellStatus = activeError
    ? "error"
    : entities === null
      ? "loading"
      : entities.length === 0
        ? "empty"
        : currentDetail === null
          ? "loading"
          : "ready";

  const current = entities?.find((e) => String(e.id) === selected);

  const retry = () => {
    setError(null);
    setRetryToken((t) => t + 1);
  };

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
  };
}

export type MetricPageState<E extends { id: number }, D> = ReturnType<
  typeof useMetricPage<E, D>
>;
export type { Persona };
```

- [ ] **Step 2: Compile** — `npx tsc --noEmit -p tsconfig.json 2>&1 | grep use-metric-page` → no errors (pre-existing test-file noise aside).
- [ ] **Step 3: Commit** — `git add src/components/metric-page/ && git commit -m "feat: metric-page data hook with derived status and explicit errors"`

---

### Task 2: The layout

**Files:** Create `src/components/metric-page/MetricPageShell.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { MetricCard } from "@/components/charts/MetricCard";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { ShellStatus } from "./use-metric-page";

export interface CardDef {
  title: string;
  value: string | number;
  delta?: number;
  description?: string;
  icon?: ReactNode;
  /** Persona gating etc.; defaults to true. */
  show?: boolean;
}

interface MetricPageShellProps<E extends { id: number }> {
  title: string;
  dateRange: string;
  onDateRangeChange: (range: string) => void;
  persona: string;
  onPersonaChange: (persona: string) => void;
  entities: E[] | null;
  selected: string;
  onSelect: (id: string) => void;
  entityLabel: (entity: E) => string;
  status: ShellStatus;
  error: string | null;
  onRetry: () => void;
  emptyMessage: string;
  cards: CardDef[];
  /** Grid columns for the card row (Tailwind needs literal classes). */
  cardColumns?: 3 | 4 | 5;
  /** Chart area — rendered only when status is "ready". */
  children: ReactNode;
}

const GRID = {
  3: "grid grid-cols-2 md:grid-cols-3 gap-4",
  4: "grid grid-cols-2 md:grid-cols-4 gap-4",
  5: "grid grid-cols-2 md:grid-cols-5 gap-4",
} as const;

/** Shared "detail loaded but series empty" notice for chart areas. */
export function EmptyNotice({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-muted-foreground">
      {message}
    </div>
  );
}

export function MetricPageShell<E extends { id: number }>({
  title,
  dateRange,
  onDateRangeChange,
  persona,
  onPersonaChange,
  entities,
  selected,
  onSelect,
  entityLabel,
  status,
  error,
  onRetry,
  emptyMessage,
  cards,
  cardColumns = 4,
  children,
}: MetricPageShellProps<E>) {
  const visibleCards = cards.filter((c) => c.show !== false);

  return (
    <div className="flex flex-col h-full">
      <Header
        title={title}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        persona={persona}
        onPersonaChange={onPersonaChange}
      />

      <div className="flex-1 p-6 space-y-6">
        {status === "error" && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-destructive">Failed to load data: {error}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}

        {status === "loading" && (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading...
          </div>
        )}

        {status === "empty" && <EmptyNotice message={emptyMessage} />}

        {status === "ready" && entities && (
          <>
            <Select
              options={entities.map((e) => ({ value: String(e.id), label: entityLabel(e) }))}
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
              className="w-64"
            />

            {visibleCards.length > 0 && (
              <div className={GRID[cardColumns]}>
                {visibleCards.map((c) => (
                  <MetricCard
                    key={c.title}
                    title={c.title}
                    value={c.value}
                    delta={c.delta}
                    description={c.description}
                    icon={c.icon}
                  />
                ))}
              </div>
            )}

            {children}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit** — `git add src/components/metric-page/ && git commit -m "feat: MetricPageShell layout with shared loading/error/empty states"`

---

### Task 3: npm + pypi transforms (TDD)

**Files:** Create `src/app/npm/aggregate.ts`, `src/app/npm/aggregate.test.ts`, `src/app/pypi/aggregate.ts`, `src/app/pypi/aggregate.test.ts`

- [ ] **Step 1: Failing tests**

`src/app/npm/aggregate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { aggregateWeekly, aggregateMonthly } from "./aggregate";

const rows = [
  { date: "2026-06-01", downloads: 10 }, // Monday
  { date: "2026-06-02", downloads: 20 },
  { date: "2026-06-08", downloads: 5 }, // next week (week starts Sunday)
  { date: "2026-07-01", downloads: 7 },
];

describe("aggregateWeekly", () => {
  it("sums downloads into Sunday-keyed weeks", () => {
    expect(aggregateWeekly(rows)).toEqual([
      { date: "2026-05-31", downloads: 30 },
      { date: "2026-06-07", downloads: 5 },
      { date: "2026-06-28", downloads: 7 },
    ]);
  });
  it("returns [] for no rows", () => {
    expect(aggregateWeekly([])).toEqual([]);
  });
});

describe("aggregateMonthly", () => {
  it("sums downloads into first-of-month keys", () => {
    expect(aggregateMonthly(rows)).toEqual([
      { date: "2026-06-01", downloads: 35 },
      { date: "2026-07-01", downloads: 7 },
    ]);
  });
});
```

`src/app/pypi/aggregate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { aggregateByDate } from "./aggregate";

describe("aggregateByDate", () => {
  it("sums mirror categories per date and sorts by date", () => {
    expect(
      aggregateByDate([
        { date: "2026-06-02", downloads: 5, categoryValue: "with_mirrors" },
        { date: "2026-06-01", downloads: 10, categoryValue: "with_mirrors" },
        { date: "2026-06-01", downloads: 3, categoryValue: "without_mirrors" },
      ])
    ).toEqual([
      { date: "2026-06-01", downloads: 13 },
      { date: "2026-06-02", downloads: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Red** — `npx vitest run src/app` → FAIL (modules missing).

- [ ] **Step 3: Implement** (bodies moved VERBATIM from the pages — parity)

`src/app/npm/aggregate.ts`:
```ts
import { toIsoDate } from "@/lib/dates";
import type { DownloadRow } from "@/lib/types/api";

/** npm-specific weekly rollup (weeks keyed by their Sunday). Page-specific by
 *  design — declared as a transform instead of buried in the page body. */
export function aggregateWeekly(data: DownloadRow[]): Record<string, string | number>[] {
  const weeks: Record<string, number> = {};
  for (const d of data) {
    const date = new Date(d.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = toIsoDate(weekStart);
    weeks[key] = (weeks[key] || 0) + d.downloads;
  }
  return Object.entries(weeks).map(([date, downloads]) => ({ date, downloads }));
}

/** npm-specific monthly rollup (keyed by the 1st of the month). */
export function aggregateMonthly(data: DownloadRow[]): Record<string, string | number>[] {
  const months: Record<string, number> = {};
  for (const d of data) {
    const key = d.date.slice(0, 7) + "-01";
    months[key] = (months[key] || 0) + d.downloads;
  }
  return Object.entries(months).map(([date, downloads]) => ({ date, downloads }));
}
```

`src/app/pypi/aggregate.ts`:
```ts
import type { PypiDownloadRow } from "@/lib/types/api";

/** Sum across categoryValues (with/without mirrors) per date, sorted. Moved
 *  verbatim from the page body. */
export function aggregateByDate(
  rows: PypiDownloadRow[]
): Array<{ date: string; downloads: number }> {
  return Object.values(
    rows.reduce<Record<string, { date: string; downloads: number }>>((acc, d) => {
      if (!acc[d.date]) acc[d.date] = { date: d.date, downloads: 0 };
      acc[d.date].downloads += d.downloads;
      return acc;
    }, {})
  ).sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 4: Green** — `npm test` → pass (if the weekly Sunday-key expectations mismatch due to local-time `getDay()`, fix the TEST to match actual output — the function body is parity-frozen).
- [ ] **Step 5: Commit** — `git add src/app/npm/aggregate* src/app/pypi/aggregate* && git commit -m "feat: npm/pypi aggregations as tested pure transforms"`

---

### Task 4: Rewrite npm and pypi pages

**Files:** Rewrite `src/app/npm/page.tsx`, `src/app/pypi/page.tsx`

- [ ] **Step 1: npm page** (complete file — the worked example all pages follow)

```tsx
"use client";

import { useState } from "react";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useMetricPage,
  type MetricPageConfig,
} from "@/components/metric-page/use-metric-page";
import { MetricPageShell, EmptyNotice } from "@/components/metric-page/MetricPageShell";
import { aggregateWeekly, aggregateMonthly } from "./aggregate";
import type { NpmPackageSummary, DownloadRow, TrackedEvent } from "@/lib/types/api";

interface NpmDetail {
  downloads: DownloadRow[];
  events: TrackedEvent[];
}

const CONFIG: MetricPageConfig<NpmDetail> = {
  listUrl: "/api/metrics/npm",
  detailUrls: (id, qs) => [`/api/metrics/npm?${qs({ packageId: id })}`, `/api/events?${qs()}`],
  combineDetail: ([downloads, events]) => ({
    downloads: downloads as DownloadRow[],
    events: events as TrackedEvent[],
  }),
};

export default function NpmPage() {
  const page = useMetricPage<NpmPackageSummary, NpmDetail>(CONFIG);
  const [aggregation, setAggregation] = useState("daily");

  const chartData = page.detail?.downloads ?? [];
  const displayData =
    aggregation === "weekly"
      ? aggregateWeekly(chartData)
      : aggregation === "monthly"
        ? aggregateMonthly(chartData)
        : chartData.map((d) => ({ date: d.date, downloads: d.downloads }));
  const totalDownloads = chartData.reduce((s, d) => s + d.downloads, 0);

  return (
    <MetricPageShell
      title="npm Downloads"
      dateRange={page.dateRange}
      onDateRangeChange={page.setDateRange}
      persona={page.persona}
      onPersonaChange={(p) => page.setPersona(p as typeof page.persona)}
      entities={page.entities}
      selected={page.selected}
      onSelect={page.setSelected}
      entityLabel={(p) => p.displayName || p.name}
      status={page.status}
      error={page.error}
      onRetry={page.retry}
      emptyMessage="No npm packages tracked. Add packages in Settings."
      cardColumns={4}
      cards={
        page.current
          ? [
              {
                title: "Weekly Downloads",
                value: page.current.downloadsLast7d,
                delta: page.current.growthPercent7d,
                description: "vs previous week",
              },
              { title: "Total in Period", value: totalDownloads },
            ]
          : []
      }
    >
      {displayData.length > 0 ? (
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Downloads - {page.current?.displayName || page.current?.name}
            </h3>
            <Tabs defaultValue="daily">
              <TabsList>
                <TabsTrigger value="daily" onClick={() => setAggregation("daily")}>
                  Daily
                </TabsTrigger>
                <TabsTrigger value="weekly" onClick={() => setAggregation("weekly")}>
                  Weekly
                </TabsTrigger>
                <TabsTrigger value="monthly" onClick={() => setAggregation("monthly")}>
                  Monthly
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <TimeSeriesChart
            data={displayData}
            metrics={[
              {
                key: "downloads",
                label: "Downloads",
                color: "var(--chart-1)",
                type: aggregation === "daily" ? "area" : "bar",
              },
            ]}
            events={page.detail?.events}
            height={400}
          />
        </div>
      ) : (
        <EmptyNotice message="No download data available. Run the data collector first." />
      )}
    </MetricPageShell>
  );
}
```

- [ ] **Step 2: pypi page** — same pattern. Config: list `/api/metrics/pypi`; detail `[/api/metrics/pypi?${qs({packageId: id})}, /api/events?${qs()}]` → `{ downloads: PypiDownloadRow[]; events: TrackedEvent[] }`. `const aggregated = aggregateByDate(page.detail?.downloads ?? [])`; cards (`cardColumns={3}`): "Weekly Downloads" = `current.downloadsLast7d`, "Total in Period" = `aggregated.reduce((s, d) => s + d.downloads, 0)`. Chart: area, `var(--chart-2)`, height 400, title `Downloads - {displayName||name}`, events from detail; EmptyNotice "No PyPI data available. Run the data collector first.". Empty message: "No PyPI packages tracked. Add packages in Settings.".

- [ ] **Step 3: Verify** — `npm run build && npm test` → pass; `grep -n "useEffect\|fetch(" src/app/npm/page.tsx src/app/pypi/page.tsx` → no matches (AC1).
- [ ] **Step 4: Commit** — `git add src/app/npm/page.tsx src/app/pypi/page.tsx && git commit -m "refactor: npm and pypi pages are declarations over the metric-page shell"`

---

### Task 5: Rewrite github and dependencies pages

**Files:** Rewrite `src/app/github/page.tsx`, `src/app/dependencies/page.tsx`; Create `src/app/dependencies/DependentsTable.tsx`

- [ ] **Step 1: github page** — config detail `[/api/metrics/github?${qs({repoId: id, metric: "all"})}, /api/events?${qs({repoId: id})}]` → `{ metrics: GithubMetricRow[]; clones: TrafficRow[]; views: TrafficRow[]; events: TrackedEvent[] }` (combine spreads the `GithubRepoMetricsResponse` with `?? []` defaults). Persona flags from `page.persona`. Cards (`cardColumns={5}`): Stars/Forks `show: showMarketing` (Star/GitFork icons), Watchers/Open Issues/Contributors `show: showEngineering` (Eye/CircleDot/Users icons), values from `page.current`. Children: stars/forks line chart gated on `metrics.length > 0 && showMarketing` (same `?? 0` mapping, colors chart-1/2, height 350, events); clones+views bar/line pair gated on `clones.length > 0 && showEngineering` (chart-3/4, height 250); else-branch `EmptyNotice "No GitHub metrics available. Run the data collector first."` when `metrics.length === 0`. Empty message: "No repos tracked yet. Add repos in Settings.". Entity label `` (r) => r.displayName || `${r.owner}/${r.name}` ``.

- [ ] **Step 2: DependentsTable** — `src/app/dependencies/DependentsTable.tsx`: the existing `<div className="border rounded-lg">…` table moved verbatim into `export function DependentsTable({ dependents, thirtyDaysAgo }: { dependents: DependentRow[]; thirtyDaysAgo: Date })` (client component; imports Badge and the contract type).

- [ ] **Step 3: dependencies page** — config detail `[/api/metrics/dependencies?${qs({packageId: id})}]` → combine `([d]) => d as DependencyDetailResponse`. Cards (`cardColumns={3}`): "Total Dependents" = `current.dependentCount` (GitFork icon), "New This Month" = `recentDeps.length` (computed from `page.detail?.dependents ?? []` with the same 30-day cutoff). Children: counts area chart (chart-2, height 300) with heading **"Dependent Count Over Time"** (fixes the rename regression) + `<DependentsTable …/>` when `dependents.length > 0`. Empty message: "No packages tracked. Add packages in Settings.". Entity label `` (p) => p.displayName || `${p.registry}/${p.name}` ``.

- [ ] **Step 4: Verify** — `npm run build && npm test`; `grep -n "useEffect\|fetch(" src/app/github/page.tsx src/app/dependencies/page.tsx` → no matches; `wc -l src/app/{github,npm,pypi,dependencies}/page.tsx` → each roughly ≤ 130 (AC2's "roughly ≤100" with the github/npm chart JSX given slack; report actuals).
- [ ] **Step 5: Commit** — `git add src/app/github/page.tsx src/app/dependencies/ && git commit -m "refactor: github and dependencies pages on the shell; fix Dependent heading regression"`

---

### Task 6: Overview rework + dead sparkline path

**Files:** Modify `src/app/page.tsx`; possibly delete `src/components/charts/SparklineCard.tsx`

- [ ] **Step 1: Rework the overview fetch** — keep its structure (4 parallel lists + first-package series; it has no entity selector so the entity hook doesn't apply) but: use `fetchJson` from the shell; replace `loading` + silent `catch(console.error)` with the keyed/derived pattern (`const [data, setData] = useState<OverviewData | null>(null)`, `const [error, setError] = useState<string | null>(null)`, `retryToken`); status derived (`error ? "error" : data === null ? "loading" : …`); render the same error UI as the shell (message + Retry button). No synchronous setState in the effect.
- [ ] **Step 2: Remove the dead sparkline path** — the "Package Overview" grid passed `data={[]}` to SparklineCard forever (dead chart). Replace each SparklineCard with `MetricCard title={pkg.displayName || pkg.name} value={`${pkg.downloadsLast7d.toLocaleString()} / week`}` — same information, no dead chart. Then `grep -rn "SparklineCard" src/` → if only the component file remains, `git rm src/components/charts/SparklineCard.tsx`.
- [ ] **Step 3: Verify** — `npm run build && npm test`.
- [ ] **Step 4: Commit** — `git add -A src/app/page.tsx src/components/charts && git commit -m "refactor: overview uses shell fetch/error pattern; remove dead sparkline path"`

---

### Task 7: events-page minimal lint fix + CLAUDE.md + AC sweep + PR

- [ ] **Step 1: events page (AC6 only)** — read its effect (`fetchEvents()` called from useEffect, with `fetchEvents` sync-calling `setLoading(true)`). Minimal compliant change: keyed/derived loading (e.g. track `events: TrackedEvent[] | null` and derive loading from `events === null`… or move `setLoading(true)` into the async continuation after the fetch starts). Touch nothing else on the page.
- [ ] **Step 2: CLAUDE.md** — extend the Dashboard architecture bullet (point 2):

```markdown
2. **Dashboard** (`src/app/`): the four metric pages (github/npm/pypi/dependencies) are declarations over the metric-page shell — `src/components/metric-page/use-metric-page.ts` (one data flow: list → auto-select → keyed detail fetch → derived `loading|error|empty|ready` status, explicit error state with retry, no silent catches) and `MetricPageShell.tsx` (chrome + state UI + declarative card grid). A new metric page = a module-level `MetricPageConfig`, a cards array, and chart children. Page-specific math lives in exported, unit-tested transforms (e.g. `src/app/npm/aggregate.ts`). API routes are thin read-only queries; charts use Recharts via wrappers in `src/components/charts/`.
```

- [ ] **Step 3: AC sweep**

```bash
grep -n "useEffect\|fetch(" src/app/github/page.tsx src/app/npm/page.tsx src/app/pypi/page.tsx src/app/dependencies/page.tsx   # AC1 → empty
wc -l src/app/{github,npm,pypi,dependencies}/page.tsx                                                                          # AC2 → report
npm test && npm run build                                                                                                       # AC6
npx eslint src/ 2>&1 | tail -3                                                                                                  # AC6: ZERO errors now
```

- [ ] **Step 4: AC3/AC4 smoke (dev server + committed DB)** — start `npm run dev` (background, default DB — read-only GETs only), curl each page route (`/`, `/github`, `/npm`, `/pypi`, `/dependencies`) → 200; curl the API endpoints → non-empty JSON (routes untouched ⇒ payloads identical by construction). Card-value parity is preserved at the formula level (verbatim moves, noted per task). AC4's UI error-state and AC3's visual spot-check (incl. npm weekly/monthly tabs) cannot be seen from the CLI — state plainly in the PR that the human should click through before merging.
- [ ] **Step 5: Commit docs + plan, push, PR.**

---

## Self-Review Notes

- **Spec coverage:** Story 1/2 → shell states + error w/ retry (Tasks 1–2); Story 3 → verbatim formula moves + parity notes; Story 4/5 → config-declaration pages (Tasks 4–5); Story 6 → Task 3 transforms; Story 7 → already done by PRD #9, pages keep importing contract types; overview hook-reuse "where applicable" → fetchJson + error UI (Task 6, deviation documented: its shape has no entity selection); dead sparkline → Task 6. AC1/2/3/4/5/6 → Task 7 sweep (AC5 was completed by PRD #9 — re-verify by grep that no page redeclares row interfaces).
- **Honest limits:** no component tests by PRD decision; visual parity and the simulated-failure UI check are explicitly handed to the human in the PR body.
- **Type consistency:** `MetricPageConfig`/`useMetricPage`/`MetricPageShell`/`CardDef`/`EmptyNotice`/`fetchJson` names match across Tasks 1–6.
