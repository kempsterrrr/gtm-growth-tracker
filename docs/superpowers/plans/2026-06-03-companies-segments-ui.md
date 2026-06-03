# Companies Page Segments & Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "who should we be speaking to" view (GitHub issue #21, parent PRD #17): Companies list gains sortable own/competitor score columns + a segment filter; company detail attributes the competitor score to the specific competitor repos and engagement that drove it.

**Architecture:** The detail API gains `competitorAttribution` — the per-repo `company_scores` rows (scope `competitor`, latest date per repo) joined to `tracked_repos` for competitor name + entity label; declared as `CompetitorAttributionRow` in the shared contract. UI logic that derives anything (segment filtering, dual-key sorting, engagement-breakdown phrasing) lives in `src/app/companies/transforms.ts` — exported, unit-tested — keeping the pages declarative. List page: segment Tabs (All/Engaged/Battleground/Prospect), clickable Score/Competitor column headers (desc→asc toggle), segment badge per row. Detail page: Competitor Score card, segment badge in the header, and a "Competitor Engagement" section rendering one row per attribution entry ("engages with Acme: 4 issues, 2 forks on pinata-sdk" — the issue's demo line).

**Tech Stack:** Existing client-page pattern (useEffect+useState — these pages predate the metric-page shell and aren't metric pages; no shell migration in scope), shadcn Tabs/Badge, Vitest for transforms + route test.

**Key facts pinned:**
- Attribution rows come from per-repo scoped score rows that #19 already writes — no new collection. Packages join the attribution via #22's depends-on signal later; the contract shape uses a generic `entity` + `displayName` so #22 extends data, not shape.
- Latest-per-repo row selection uses a correlated `MAX(date)` subquery; per-repo rows are unique per (company, repo, date) so exactly one row survives per repo. Rows whose repo has since lost its competitor attribution (stale scope) are skipped.
- Segment badge variants: prospect → `default` (brand primary — the headline segment), battleground → `secondary`, engaged → `outline`.
- Breakdown phrasing: counts in demand-significance order (issues, forks, stars, PRs, commits), zeros skipped, singular/plural handled, empty → "no engagement recorded".
- Sorting: header click sorts desc, second click asc; no third state (back to API order is not worth a tri-state). Default order = API order (max of the two scores, desc — from #19).
- E2E demo mirrors #19/#20: DB copy + seeded competitor engagement + real scoring + headless-Chromium click-through (filter → sort → detail attribution visible).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-companies-segments-ui.md` | Create | This plan |
| `src/lib/types/sales-intelligence.ts` | Modify | `CompetitorAttributionRow`; `CompanyDetail.competitorAttribution` |
| `src/lib/types/api.ts` | Modify | Re-export `CompetitorAttributionRow` |
| `src/app/api/companies/[id]/route.ts` | Modify | Attribution query + payload |
| `src/app/api/companies/[id]/route.test.ts` | Modify | Attribution assertions |
| `src/app/companies/transforms.ts` + `.test.ts` | Create | `filterCompanies`, `sortCompanies`, `formatEngagementBreakdown` |
| `src/app/companies/page.tsx` | Modify | Segment tabs, dual sortable columns, segment badges |
| `src/app/companies/[id]/page.tsx` | Modify | Competitor Score card, segment badge, attribution section |
| `CLAUDE.md` | Modify | One-line convention note |

---

### Task 1: Branch + commit the plan

- [ ] **Step 1:**

```bash
git checkout -b feat/companies-segments
git add docs/superpowers/plans/2026-06-03-companies-segments-ui.md
git commit -m "docs: implementation plan for companies segments + attribution UI (#21)"
```

---

### Task 2: Contract + detail-route attribution

**Files:**
- Modify: `src/lib/types/sales-intelligence.ts`, `src/lib/types/api.ts`
- Modify: `src/app/api/companies/[id]/route.ts`
- Test: `src/app/api/companies/[id]/route.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/app/api/companies/[id]/route.test.ts`, extend the seed block (after the existing `aggregate(...)` calls):

```ts
// Per-repo competitor attribution rows: two dates for the same repo — the
// route must return only the latest.
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, display_name, competitor) VALUES ('pinata', 'pinata-sdk', 'Pinata SDK', 'Pinata')"
  )
  .run();
const rivalRepoId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name='pinata-sdk'").get() as { id: number }
).id;
const repoScore = (date: string, score: number, issues: number, forks: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count, star_count, fork_count, issue_count, pr_count, commit_count) VALUES (?, ?, 'competitor', ?, ?, 1, 0, ?, ?, 0, 0)"
    )
    .run(companyId, rivalRepoId, date, score, forks, issues);
repoScore(daysAgoIso(3), 8, 2, 1);
repoScore(todayIso(), 14, 4, 2);
```

and a new test in the describe:

```ts
  it("attributes the competitor score to its source repos (latest row per repo)", async () => {
    const res = await request(companyId);
    const body = (await res.json()) as CompanyDetail;
    expect(body.competitorAttribution).toEqual([
      {
        competitor: "Pinata",
        entity: "pinata/pinata-sdk",
        displayName: "Pinata SDK",
        score: 14,
        userCount: 1,
        starCount: 0,
        forkCount: 2,
        issueCount: 4,
        prCount: 0,
        commitCount: 0,
      },
    ]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/app/api/companies/[id]/route.test.ts"` → FAIL (`competitorAttribution` undefined).

- [ ] **Step 3: Implement — contract + query**

In `src/lib/types/sales-intelligence.ts`, after `CompanyUser`:

```ts
/** One competitor entity (repo today; packages join via the depends-on
 *  signal in #22) that contributed to a company's competitor score, with the
 *  engagement breakdown behind it — so outreach can reference the specific
 *  competitor product the company is using. */
export interface CompetitorAttributionRow {
  competitor: string;
  /** Repo as "owner/name" (package name once #22 lands). */
  entity: string;
  displayName: string | null;
  score: number;
  userCount: number;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
}
```

and `CompanyDetail` gains:

```ts
export interface CompanyDetail extends Omit<CompanySummary, "scoreTrend"> {
  users: CompanyUser[];
  scoreHistory: Array<{ date: string; score: number }>;
  /** Which competitor repos/packages drove competitorScore (latest per entity). */
  competitorAttribution: CompetitorAttributionRow[];
}
```

In `src/lib/types/api.ts`, add `CompetitorAttributionRow` to the sales-intelligence re-export block.

In `src/app/api/companies/[id]/route.ts`: add `trackedRepos` to the schema import, then after the `scoreHistory` query:

```ts
  // Which competitor repos drove the competitor score — latest per-repo row.
  // Rows whose repo has since lost its competitor attribution are skipped.
  const attributionRows = db
    .select({
      owner: trackedRepos.owner,
      name: trackedRepos.name,
      displayName: trackedRepos.displayName,
      competitor: trackedRepos.competitor,
      score: companyScores.score,
      userCount: companyScores.userCount,
      starCount: companyScores.starCount,
      forkCount: companyScores.forkCount,
      issueCount: companyScores.issueCount,
      prCount: companyScores.prCount,
      commitCount: companyScores.commitCount,
    })
    .from(companyScores)
    .innerJoin(trackedRepos, sql`${companyScores.repoId} = ${trackedRepos.id}`)
    .where(
      sql`${companyScores.companyId} = ${companyId} AND ${companyScores.scope} = 'competitor' AND ${companyScores.date} = (
        SELECT MAX(date) FROM company_scores cs2
        WHERE cs2.company_id = ${companyScores.companyId}
          AND cs2.repo_id = ${companyScores.repoId}
          AND cs2.scope = 'competitor'
      )`
    )
    .orderBy(desc(companyScores.score))
    .all();
  const competitorAttribution = attributionRows
    .filter((r) => r.competitor != null)
    .map((r) => ({
      competitor: r.competitor!,
      entity: `${r.owner}/${r.name}`,
      displayName: r.displayName,
      score: r.score,
      userCount: r.userCount,
      starCount: r.starCount,
      forkCount: r.forkCount,
      issueCount: r.issueCount,
      prCount: r.prCount,
      commitCount: r.commitCount,
    }));
```

and the payload gains `competitorAttribution,`.

- [ ] **Step 4: Verify green, commit**

```bash
npx vitest run "src/app/api/companies/[id]/route.test.ts"
git add src/lib/types/sales-intelligence.ts src/lib/types/api.ts "src/app/api/companies/[id]/route.ts" "src/app/api/companies/[id]/route.test.ts"
git commit -m "feat: company detail attributes competitor score to source repos"
```

---

### Task 3: Page transforms

**Files:**
- Create: `src/app/companies/transforms.ts`, `src/app/companies/transforms.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/companies/transforms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterCompanies, sortCompanies, formatEngagementBreakdown } from "./transforms";
import type { CompanySummary } from "@/lib/types/api";

const company = (over: Partial<CompanySummary>): CompanySummary => ({
  id: 1,
  name: "x",
  domain: null,
  website: null,
  industry: null,
  employeeCount: null,
  score: 0,
  competitorScore: 0,
  segment: "engaged",
  userCount: 0,
  starCount: 0,
  forkCount: 0,
  issueCount: 0,
  prCount: 0,
  commitCount: 0,
  scoreTrend: 0,
  ...over,
});

describe("filterCompanies", () => {
  const list = [
    company({ id: 1, segment: "engaged" }),
    company({ id: 2, segment: "battleground" }),
    company({ id: 3, segment: "prospect" }),
  ];
  it("'all' passes everything through", () => {
    expect(filterCompanies(list, "all").map((c) => c.id)).toEqual([1, 2, 3]);
  });
  it("narrows to one segment", () => {
    expect(filterCompanies(list, "prospect").map((c) => c.id)).toEqual([3]);
  });
});

describe("sortCompanies", () => {
  const list = [
    company({ id: 1, score: 10, competitorScore: 50 }),
    company({ id: 2, score: 30, competitorScore: 5 }),
    company({ id: 3, score: 20, competitorScore: 20 }),
  ];
  it("null sort keeps the API order", () => {
    expect(sortCompanies(list, null).map((c) => c.id)).toEqual([1, 2, 3]);
  });
  it("sorts by own score desc and asc", () => {
    expect(sortCompanies(list, { key: "score", dir: "desc" }).map((c) => c.id)).toEqual([2, 3, 1]);
    expect(sortCompanies(list, { key: "score", dir: "asc" }).map((c) => c.id)).toEqual([1, 3, 2]);
  });
  it("sorts by competitor score without mutating the input", () => {
    const sorted = sortCompanies(list, { key: "competitorScore", dir: "desc" });
    expect(sorted.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(list.map((c) => c.id)).toEqual([1, 2, 3]);
  });
});

describe("formatEngagementBreakdown", () => {
  it("phrases counts in demand-significance order, skipping zeros", () => {
    expect(
      formatEngagementBreakdown({
        issueCount: 4,
        forkCount: 2,
        starCount: 0,
        prCount: 0,
        commitCount: 0,
      })
    ).toBe("4 issues, 2 forks");
  });
  it("handles singulars and the full set", () => {
    expect(
      formatEngagementBreakdown({
        issueCount: 1,
        forkCount: 1,
        starCount: 3,
        prCount: 1,
        commitCount: 2,
      })
    ).toBe("1 issue, 1 fork, 3 stars, 1 PR, 2 commits");
  });
  it("falls back when everything is zero", () => {
    expect(
      formatEngagementBreakdown({
        issueCount: 0,
        forkCount: 0,
        starCount: 0,
        prCount: 0,
        commitCount: 0,
      })
    ).toBe("no engagement recorded");
  });
});
```

- [ ] **Step 2: Run to verify failure** → module missing.

- [ ] **Step 3: Implement**

Create `src/app/companies/transforms.ts`:

```ts
import type { CompanySummary, CompanySegment } from "@/lib/types/api";

/** Companies-page derivations — exported and unit-tested per convention. */

export type SegmentFilter = CompanySegment | "all";

export function filterCompanies(
  companies: CompanySummary[],
  segment: SegmentFilter
): CompanySummary[] {
  if (segment === "all") return companies;
  return companies.filter((c) => c.segment === segment);
}

export type SortKey = "score" | "competitorScore";
export interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}

export function sortCompanies(
  companies: CompanySummary[],
  sort: SortSpec | null
): CompanySummary[] {
  if (!sort) return companies;
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...companies].sort((a, b) => sign * (a[sort.key] - b[sort.key]));
}

/** "4 issues, 2 forks" — demand-significance order (issues, forks, stars,
 *  PRs, commits), zeros skipped. The outreach line on the detail page. */
export function formatEngagementBreakdown(counts: {
  issueCount: number;
  forkCount: number;
  starCount: number;
  prCount: number;
  commitCount: number;
}): string {
  const parts: string[] = [];
  const add = (n: number, singular: string, plural = `${singular}s`) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  add(counts.issueCount, "issue");
  add(counts.forkCount, "fork");
  add(counts.starCount, "star");
  add(counts.prCount, "PR");
  add(counts.commitCount, "commit");
  return parts.length > 0 ? parts.join(", ") : "no engagement recorded";
}
```

- [ ] **Step 4: Verify green, commit**

```bash
npx vitest run src/app/companies/transforms.test.ts
git add src/app/companies/transforms.ts src/app/companies/transforms.test.ts
git commit -m "feat: companies-page transforms (segment filter, dual-key sort, breakdown phrasing)"
```

---

### Task 4: List page — segment tabs, sortable dual score columns, segment badges

**Files:**
- Modify: `src/app/companies/page.tsx`

- [ ] **Step 1: Wire the page**

(a) Imports: add Tabs + transforms + segment type:

```ts
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  filterCompanies,
  sortCompanies,
  type SegmentFilter,
  type SortSpec,
  type SortKey,
} from "./transforms";
import type { CompanySummary, CompanySegment } from "@/lib/types/sales-intelligence";
```

(b) Module-level badge variants:

```ts
const SEGMENT_BADGE: Record<CompanySegment, "default" | "secondary" | "outline"> = {
  prospect: "default",
  battleground: "secondary",
  engaged: "outline",
};
```

(c) State + derived list (after the existing useState pair):

```ts
  const [segment, setSegment] = useState<SegmentFilter>("all");
  const [sort, setSort] = useState<SortSpec | null>(null);

  const visible = sortCompanies(filterCompanies(companies, segment), sort);

  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur?.key === key
        ? { key, dir: cur.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    );
  const sortIndicator = (key: SortKey) =>
    sort?.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : "";
```

(d) Segment tabs above the table (inside the `{!loading && companies.length > 0 && (...)}` block, wrapping the existing table div):

```tsx
          <div className="space-y-3">
            <Tabs value={segment} onValueChange={(v) => setSegment(v as SegmentFilter)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="engaged">Engaged</TabsTrigger>
                <TabsTrigger value="battleground">Battleground</TabsTrigger>
                <TabsTrigger value="prospect">Net-new Prospect</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="border rounded-lg">
              ...existing table, mapped over `visible` instead of `companies`...
            </div>
          </div>
```

(e) Table headers: Score becomes a clickable Own Score header + new Competitor header + Segment column:

```tsx
                    <th className="text-right px-4 py-2 font-medium">
                      <button className="hover:text-foreground" onClick={() => toggleSort("score")}>
                        Score{sortIndicator("score")}
                      </button>
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <button
                        className="hover:text-foreground"
                        onClick={() => toggleSort("competitorScore")}
                      >
                        Competitor{sortIndicator("competitorScore")}
                      </button>
                    </th>
                    <th className="text-left px-4 py-2 font-medium">Segment</th>
```

(f) Row cells after the existing score cell:

```tsx
                      <td className="px-4 py-2 text-right font-medium">
                        {company.competitorScore > 0 ? company.competitorScore.toFixed(0) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={SEGMENT_BADGE[company.segment]} className="text-xs">
                          {company.segment === "prospect" ? "net-new prospect" : company.segment}
                        </Badge>
                      </td>
```

(g) Rows map over `visible`; the rank cell `{i + 1}` stays (rank within the current view). Empty filtered state: if `visible.length === 0` show a small notice under the tabs instead of the table:

```tsx
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                No {segment === "all" ? "" : segment + " "}companies yet.
              </p>
            ) : (
              <div className="border rounded-lg">…table…</div>
            )}
```

(h) Header subtitle: "Companies detected from GitHub engagement with your repos" → "Companies detected from GitHub engagement with your repos and your competitors'".

- [ ] **Step 2: Lint + build, commit**

```bash
npm run lint && npm run build
git add src/app/companies/page.tsx
git commit -m "feat: companies list gains segment filter, sortable dual scores, segment badges"
```

---

### Task 5: Detail page — competitor card, segment badge, attribution section

**Files:**
- Modify: `src/app/companies/[id]/page.tsx`

- [ ] **Step 1: Wire the page**

(a) Imports: `formatEngagementBreakdown` from `../transforms`, `CompetitorAttributionRow` type, and the same `SEGMENT_BADGE` map (duplicate the 5-line const — the two pages don't share a module today; keeping it local mirrors the existing style):

```ts
import { formatEngagementBreakdown } from "../transforms";
import type {
  CompanyDetail,
  CompanyUser,
  EngagementEventType,
  CompanySegment,
} from "@/lib/types/sales-intelligence";

const SEGMENT_BADGE: Record<CompanySegment, "default" | "secondary" | "outline"> = {
  prospect: "default",
  battleground: "secondary",
  engaged: "outline",
};
```

(b) Header badges row gains the segment badge (after the industry badge):

```tsx
          <Badge variant={SEGMENT_BADGE[company.segment]} className="text-xs">
            {company.segment === "prospect" ? "net-new prospect" : company.segment}
          </Badge>
```

(c) KPI cards: grid becomes `md:grid-cols-6` and gains:

```tsx
          <MetricCard title="Competitor Score" value={company.competitorScore.toFixed(0)} />
```

(after the Score card).

(d) New section between "Score Breakdown" and "Score Over Time":

```tsx
        {/* Competitor attribution — which competitor products this company uses */}
        {company.competitorAttribution && company.competitorAttribution.length > 0 && (
          <div className="border rounded-lg">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">Competitor Engagement</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                What drove the competitor score of {company.competitorScore.toFixed(0)}
              </p>
            </div>
            <div className="divide-y">
              {company.competitorAttribution.map((row) => (
                <div key={row.entity} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm">
                      engages with <span className="font-medium">{row.competitor}</span>:{" "}
                      {formatEngagementBreakdown(row)} on{" "}
                      <span className="font-medium">{row.displayName || row.entity}</span>
                    </span>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {row.entity} · {row.userCount} {row.userCount === 1 ? "user" : "users"}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {row.score.toFixed(0)} pts
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 2: Lint + build, commit**

```bash
npm run lint && npm run build
git add "src/app/companies/[id]/page.tsx"
git commit -m "feat: company detail shows segment, competitor score, and per-competitor attribution"
```

---

### Task 6: Docs + verification + demo + PR/merge

- [ ] **Step 1: CLAUDE.md** — in the scoring paragraph (Configuration flow), append one sentence:

```markdown
The Companies UI derives its filter/sort/phrasing in
`src/app/companies/transforms.ts` (exported, unit-tested); the detail API's
`competitorAttribution` exposes the latest per-repo competitor score rows.
```

```bash
git add CLAUDE.md && git commit -m "docs: companies transforms convention in CLAUDE.md"
```

- [ ] **Step 2: Full suite, lint, build**

```bash
npm test && npm run lint && npm run build
```

- [ ] **Step 3: Demo on a DB copy** (mirrors #19's seed: competitor repo + issue engagement → real scoring → API), then headless click-through:

1. `cp data/gtm-tracker.db /tmp/demo21.db && DATABASE_PATH=/tmp/demo21.db npm run db:migrate`
2. Seed via in-repo scratch (`.demo21-seed.ts`, deleted after): competitor repo `pinata/pinata-sdk` (competitor "Pinata"), user, company "DemoProspect Inc", user-company link, 4 issue + 2 fork engagement events, then `scoreCompanies()`.
3. `DATABASE_PATH=/tmp/demo21.db npm run dev` (background); curl `/api/companies/<id>` → `competitorAttribution[0]` matches `{competitor: "Pinata", issueCount: 4, forkCount: 2}`.
4. Headless-Chromium click-through (playwright-core, transient install): open `/companies`, click "Net-new Prospect" tab → DemoProspect visible; click "Competitor" header (sort); click through to the company → assert the page text contains `engages with Pinata: 4 issues, 2 forks on Pinata SDK`.
5. Teardown: kill server, `npm uninstall --no-save playwright-core`, rm scratch + DB copy, `git status` clean.

- [ ] **Step 4: PR + merge (standing authorization)**

PR body: per-AC table (4 ACs) + notes (attribution is repo-sourced until #22 adds package dependents; pages keep their pre-shell useEffect style — not metric pages; segment badge variant mapping). Merge with `--delete-branch`, confirm #21 auto-closed.

---

## Self-Review

1. **AC coverage:** dual sortable columns → Task 4 (toggleSort both keys, tested transform); segment filter → Tasks 3+4; per-competitor attribution on detail → Tasks 2+5 (the issue's exact demo line via `formatEngagementBreakdown`); contract + tested transforms → Tasks 2+3.
2. **Placeholder scan:** Task 4 (d)/(g) reference "existing table" — explicit keep-and-rewire instructions with the changed cells fully written; all new code shown.
3. **Type consistency:** `SegmentFilter`/`SortSpec`/`SortKey` defined once in transforms; `CompetitorAttributionRow` field names match the route mapping and the test expectation; `SEGMENT_BADGE` keys match `CompanySegment`.
