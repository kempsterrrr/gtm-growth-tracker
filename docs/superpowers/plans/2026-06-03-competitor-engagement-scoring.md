# Competitor Engagement, Dual Scores & Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The competitor-intel tracer bullet (GitHub issue #19, parent PRD #17): competitor-repo engagement flows through the existing engagement → enrichment → company-resolution chain and produces per-company dual aggregates (own + competitor) with a derived segment (engaged / battleground / prospect) in the companies API.

**Architecture:** No new pipeline steps. The engagement collector gains a **backfill mode** for a competitor repo's first collection (issues since epoch, more star/fork/PR pages, flagged done via a `backfilled` cursor) and enqueues competitor-sourced users at a **lower priority band** (−100 offset; the queue's MAX-upsert lifts users who also touch our repos). The scoring step selects a **weight table per repo** from its competitor attribution and writes **scope-discriminated** rows: per-repo rows stamped `own`/`competitor`, and per-scope aggregate rows (repo_id NULL) written **delete-then-insert** — which also fixes a live latent bug (SQLite treats NULL as distinct in UNIQUE indexes, so the old aggregate upsert never conflicted and re-runs duplicated aggregate rows; the production DB has triplicates today). Segment is derived at query time by an exported pure transform. Alert queries pin `scope='own'` so semantics don't shift before #24.

**Tech Stack:** Drizzle ORM (synchronous better-sqlite3), drizzle-kit generated migration `0002`, Vitest with real temp SQLite + injected fake `GithubClient`, existing API-contract discipline (`src/lib/types/sales-intelligence.ts` re-exported through `api.ts`).

**Key facts pinned:**
- **Latent duplicate-aggregate bug is real and live**: `UNIQUE(company_id, repo_id, date)` never fires for `repo_id IS NULL` (SQLite NULL-distinctness), production DB has 3 aggregate rows per company for 2026-06-03. Fix = delete-then-insert for aggregates + `ORDER BY date DESC, id DESC LIMIT 1` reads. **No DML migration** (generated migrations stay pure DDL); historical duplicates become harmless residue replaced on next scoring run.
- **No CHECK constraint on the new `scope` column** — drizzle-kit would have to recreate the table to add a table-level CHECK; a plain `ALTER TABLE ... ADD ... DEFAULT 'own' NOT NULL` keeps the migration additive and the upgrade-path gate trivially green. The enum lives at the type level (`text("scope", { enum: [...] })`), matching how several columns already rely on app-level discipline.
- **Backfill scope choice**: stars/forks page caps raised (60 pages ≈ 6k entries — PRD's mid-size assumption), issues `since` = epoch, PRs 20 pages; **commits stay on the 90-day window** (commits are a weight-0 employee signal — #23 — and full PR history plus org/domain signals cover employee tagging; documented in the PR).
- A repo **flipping to competitor later** backfills on its next run (the `backfilled` cursor is only consulted for competitor repos) — desirable: newly-attributed competitors get full history.
- **Breadth bonus gating**: a user only counts toward `userCount`/breadth if their weighted score > 0. On own repos this is a no-op (all own weights ≥ 1); on competitor repos it keeps commits/PR-only users (the competitor's own team, properly tagged in #23) from inflating prospect scores via the +2/user bonus.
- Competitor weight values (PRD gives ordering, not numbers): `issue/issue_comment 8, fork 3, star 1, pr/pr_review/commit 0`.
- `CompanySummary.score` keeps meaning **own** score (back-compat); `competitorScore` + `segment` are added. List ordering becomes `max(own, competitor) DESC` and `minScore` filters on that max — identical to today for all pre-competitor data. `scoreTrend` and `scoreHistory` stay own-only (detail-page competitor series is #21/#20 territory).
- The companies UI pages only read existing fields — additive payload changes can't break them; UI work is #21.
- Demo runs against a **copy** of the dev DB (seeded synthetic competitor engagement + real scoring step + real API); the dev DB and config stay untouched.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-competitor-engagement-scoring.md` | Create | This plan |
| `src/lib/db/schema.ts` | Modify | `scope` column on `companyScores` |
| `drizzle/0002_company-score-scope.sql` + `drizzle/meta/*` | Generate | The migration |
| `src/lib/db/migrate.test.ts` | Modify | Column assertion for `scope` |
| `src/lib/types/scoring.ts` | Modify | `COMPETITOR_ENGAGEMENT_WEIGHTS`, `COMPETITOR_PRIORITY_OFFSET` |
| `src/lib/segments.ts` + `src/lib/segments.test.ts` | Create | `deriveSegment` pure transform + matrix tests |
| `src/lib/types/sales-intelligence.ts` | Modify | `CompanySegment`, dual-score fields on `CompanySummary` |
| `src/lib/types/api.ts` | Modify | Re-export `CompanySegment` |
| `src/lib/collectors/github-engagement.ts` | Modify | Backfill mode + competitor-aware queue priority |
| `src/lib/collectors/github-engagement-backfill.test.ts` | Create | Backfill + priority tests (fake client, fresh temp DB) |
| `src/lib/collectors/company-scoring.ts` | Modify | Weight table per repo, scope stamping, dual aggregates, delete-then-insert |
| `src/lib/collectors/company-scoring.test.ts` | Create | Dual-aggregate math + idempotency tests |
| `src/lib/collectors/alerts-evaluator.ts` | Modify | Pin `scope='own'` in both aggregate reads |
| `src/lib/collectors/alerts-evaluator.test.ts` | Create | Competitor rows don't fire own alerts |
| `src/app/api/companies/route.ts` | Rewrite query | Dual scores + segment + duplicate-proof reads |
| `src/app/api/companies/route.test.ts` | Create | Segments/ordering/contract tests |
| `src/app/api/companies/[id]/route.ts` | Modify | Dual scores + segment, own-scoped history |
| `src/app/api/companies/[id]/route.test.ts` | Create | Detail payload tests |
| `CLAUDE.md` | Modify | Scoring-scope conventions |

No changes: pipeline definition (no new steps), enrichment/commit-emails/company-resolution collectors, companies UI pages, slack-notifier.

---

### Task 1: Branch + commit the plan

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/competitor-scoring
```

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-06-03-competitor-engagement-scoring.md
git commit -m "docs: implementation plan for competitor engagement + dual scores (#19)"
```

---

### Task 2: `scope` column on company_scores + migration

**Files:**
- Modify: `src/lib/db/schema.ts` (companyScores, ~line 344)
- Modify: `src/lib/db/migrate.test.ts` (append one test in the upgrade-path describe)
- Generate: `drizzle/0002_company-score-scope.sql`, meta files

- [ ] **Step 1: Add the failing column assertion**

In `src/lib/db/migrate.test.ts`, append inside `describe("schema equivalence (upgrade-path gate)")`:

```ts
  it("the migrations add the scoped company-score column", () => {
    process.env.DATABASE_PATH = path.join(tmp, "columns-scope.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const col = (
      db.prepare("PRAGMA table_info(company_scores)").all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>
    )
      .filter((c) => c.name === "scope")
      .map((c) => ({ name: c.name, notnull: c.notnull, dflt: c.dflt_value }));
    expect(col).toEqual([{ name: "scope", notnull: 1, dflt: "'own'" }]);
    db.close();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/db/migrate.test.ts`
Expected: FAIL — no `scope` column yet.

- [ ] **Step 3: Add the column to the schema**

In `src/lib/db/schema.ts`, `companyScores` gains one line after `repoId`:

```ts
    repoId: integer("repo_id").references(() => trackedRepos.id),
    scope: text("scope", { enum: ["own", "competitor"] })
      .notNull()
      .default("own"),
```

- [ ] **Step 4: Generate the migration**

```bash
npx drizzle-kit generate --name company-score-scope
```

Review `drizzle/0002_company-score-scope.sql` — exactly one additive statement, no table recreation:

```sql
ALTER TABLE `company_scores` ADD `scope` text DEFAULT 'own' NOT NULL;
```

- [ ] **Step 5: Run the migrate suite**

Run: `npx vitest run src/lib/db/migrate.test.ts`
Expected: PASS (5 tests) — upgrade-path equivalence, both column tests, live-data no-op.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.test.ts drizzle/
git commit -m "feat: scope discriminator on company_scores (own|competitor)"
```

---

### Task 3: Scoring constants + segment transform

**Files:**
- Modify: `src/lib/types/scoring.ts`
- Modify: `src/lib/types/sales-intelligence.ts` (CompanySegment type)
- Create: `src/lib/segments.ts`, `src/lib/segments.test.ts`

- [ ] **Step 1: Write the failing segment tests**

Create `src/lib/segments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveSegment } from "./segments";

describe("deriveSegment (PRD #17 segment matrix)", () => {
  it("own only → engaged", () => {
    expect(deriveSegment(12, 0)).toBe("engaged");
  });
  it("both → battleground", () => {
    expect(deriveSegment(12, 8)).toBe("battleground");
  });
  it("competitor only → prospect", () => {
    expect(deriveSegment(0, 8)).toBe("prospect");
  });
  it("neither (degenerate, unlisted companies) → engaged", () => {
    expect(deriveSegment(0, 0)).toBe("engaged");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/segments.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the type, transform, and constants**

In `src/lib/types/sales-intelligence.ts`, after `AlertRuleType`:

```ts
export type CompanySegment = "engaged" | "battleground" | "prospect";
```

Create `src/lib/segments.ts`:

```ts
import type { CompanySegment } from "./types/sales-intelligence";

/** The segment matrix from PRD #17: own engagement only → engaged, both →
 *  battleground, competitor engagement only → net-new prospect. Derived at
 *  query time, never stored. (0,0) is unreachable for listed companies —
 *  they only appear with at least one aggregate — and maps to "engaged" as
 *  the least-alarming default. */
export function deriveSegment(ownScore: number, competitorScore: number): CompanySegment {
  if (competitorScore > 0 && ownScore > 0) return "battleground";
  if (competitorScore > 0) return "prospect";
  return "engaged";
}
```

In `src/lib/types/scoring.ts`, append:

```ts
/** Signal semantics flip on competitor repos (PRD #17): demand signals rank
 *  prospects — issues high, forks medium, stars low — while supply signals
 *  (commits, PRs, reviews) identify competitor employees and carry no
 *  prospect value (weight 0; tagging/exclusion lands in #23). */
export const COMPETITOR_ENGAGEMENT_WEIGHTS: Record<EngagementEventType, number> = {
  star: 1,
  fork: 3,
  issue: 8,
  issue_comment: 8,
  pr: 0,
  pr_review: 0,
  commit: 0,
};

/** Enrichment queue: own-repo users always rank above competitor-repo users.
 *  Applied as an offset so the per-event-type ordering is preserved within
 *  the competitor band, and the queue's MAX() upsert lifts anyone who also
 *  engages our own repos into the own band. */
export const COMPETITOR_PRIORITY_OFFSET = -100;
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/lib/segments.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/scoring.ts src/lib/types/sales-intelligence.ts src/lib/segments.ts src/lib/segments.test.ts
git commit -m "feat: competitor weight table, priority offset, and segment transform"
```

---

### Task 4: Engagement collector — backfill mode + competitor queue priority

**Files:**
- Modify: `src/lib/collectors/github-engagement.ts`
- Create: `src/lib/collectors/github-engagement-backfill.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/collectors/github-engagement-backfill.test.ts` (fresh temp DB — the existing engagement suite's DB-wide queue assertions must not see these users):

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { GithubClient, Page, PageOptions } from "../api-clients/github-client";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-backfill-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { collectGithubEngagement } = await import("./github-engagement");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare("INSERT INTO tracked_repos (owner, name) VALUES ('us', 'own-repo')")
  .run();
sqlite
  .prepare(
    "INSERT INTO tracked_repos (owner, name, competitor) VALUES ('them', 'rival-repo', 'Acme')"
  )
  .run();
const rivalId = (
  sqlite.prepare("SELECT id FROM tracked_repos WHERE name = 'rival-repo'").get() as { id: number }
).id;

// Per-repo call recorder: the test's whole point is asserting WHAT the
// collector asks the client for on first vs subsequent collections.
const calls: Record<string, { stars: PageOptions[]; forks: PageOptions[]; issuesSince: string[]; prs: PageOptions[] }> = {
  "own-repo": { stars: [], forks: [], issuesSince: [], prs: [] },
  "rival-repo": { stars: [], forks: [], issuesSince: [], prs: [] },
};

async function* onePage<T>(items: T[]): AsyncGenerator<Page<T>> {
  if (items.length > 0) yield { page: 1, items, isLast: true };
}
async function* noPages<T>(): AsyncGenerator<Page<T>> {}

const fakeClient: GithubClient = {
  getRepo: async () => {
    throw new Error("not used");
  },
  getTrafficClones: async () => {
    throw new Error("not used");
  },
  getTrafficViews: async () => {
    throw new Error("not used");
  },
  getReleases: async () => {
    throw new Error("not used");
  },
  getContributorStats: async () => {
    throw new Error("not used");
  },
  getUserProfile: async () => {
    throw new Error("not used");
  },
  getUserOrgs: async () => {
    throw new Error("not used");
  },
  stargazerPages: (owner, repo, opts) => {
    calls[repo].stars.push(opts!);
    return repo === "rival-repo"
      ? onePage([
          { user: { login: "both-sides", id: 1, avatar_url: "" }, starred_at: "2026-06-01T10:00:00Z" },
          { user: { login: "rival-fan", id: 2, avatar_url: "" }, starred_at: "2026-06-01T11:00:00Z" },
        ])
      : onePage([
          { user: { login: "both-sides", id: 1, avatar_url: "" }, starred_at: "2026-06-02T10:00:00Z" },
        ]);
  },
  forkPages: (owner, repo, opts) => {
    calls[repo].forks.push(opts!);
    return noPages();
  },
  issuePages: (owner, repo, since, opts) => {
    calls[repo].issuesSince.push(since);
    return repo === "rival-repo"
      ? onePage([
          {
            number: 7,
            title: "old pain",
            created_at: "2024-01-15T00:00:00Z",
            user: { login: "rival-filer", id: 3, avatar_url: "" },
          },
        ])
      : noPages();
  },
  prPages: (owner, repo, opts) => {
    calls[repo].prs.push(opts!);
    return noPages();
  },
  commitPages: () => noPages(),
};

describe("competitor backfill on first collection", () => {
  it("first run: full history for the competitor repo, normal windows for our own", async () => {
    await collectGithubEngagement(fakeClient);

    // Competitor repo: backfill mode
    expect(calls["rival-repo"].stars[0].maxPages).toBe(60);
    expect(calls["rival-repo"].forks[0].maxPages).toBe(60);
    expect(calls["rival-repo"].issuesSince[0]).toBe("1970-01-01T00:00:00.000Z");
    expect(calls["rival-repo"].prs[0].maxPages).toBe(20);

    // Own repo: existing behavior (5-page cap, ~90-day issue window)
    expect(calls["own-repo"].stars[0].maxPages).toBe(5);
    expect(calls["own-repo"].issuesSince[0]).not.toBe("1970-01-01T00:00:00.000Z");
    expect(calls["own-repo"].prs[0].maxPages).toBe(3);

    // Backfill flagged done
    const backfilled = sqlite
      .prepare(
        "SELECT cursor_value FROM collection_cursors WHERE cursor_type = 'backfilled' AND repo_id = ?"
      )
      .get(rivalId) as { cursor_value: string } | undefined;
    expect(backfilled?.cursor_value).toBe("1");

    // Old issue author captured — the whole point of the backfill
    const issueEvent = sqlite
      .prepare(
        "SELECT event_date FROM github_engagement_events WHERE repo_id = ? AND event_type = 'issue'"
      )
      .get(rivalId) as { event_date: string };
    expect(issueEvent.event_date).toBe("2024-01-15");
  });

  it("competitor-sourced users enqueue below own-repo users; both-sides users get the own band", async () => {
    const priority = (login: string) =>
      (
        sqlite.prepare("SELECT priority FROM enrichment_queue WHERE user_login = ?").get(login) as {
          priority: number;
        }
      ).priority;

    expect(priority("rival-fan")).toBe(1 - 100); // competitor star
    expect(priority("rival-filer")).toBe(3 - 100); // competitor issue
    expect(priority("both-sides")).toBe(1); // starred both — MAX() lifts to own band
  });

  it("second run: competitor repo back on incremental windows", async () => {
    await collectGithubEngagement(fakeClient);

    expect(calls["rival-repo"].stars[1].maxPages).toBe(5);
    expect(calls["rival-repo"].forks[1].maxPages).toBe(5);
    expect(calls["rival-repo"].issuesSince[1]).not.toBe("1970-01-01T00:00:00.000Z");
    expect(calls["rival-repo"].prs[1].maxPages).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/collectors/github-engagement-backfill.test.ts`
Expected: FAIL — maxPages is 5 (no backfill mode), issue since is the 90-day default, priorities are positive for all users.

- [ ] **Step 3: Implement backfill mode + priority offset**

In `src/lib/collectors/github-engagement.ts`:

(a) Import the offset (line 4):

```ts
import { ENRICHMENT_PRIORITY, COMPETITOR_PRIORITY_OFFSET } from "../types/scoring";
```

(b) Constants under `MAX_PAGES_PER_ENDPOINT`:

```ts
const MAX_PAGES_PER_ENDPOINT = 5;
// First collection of a competitor repo backfills full engagement history so
// the prospect list is complete immediately (PRD #17). Sized for the PRD's
// mid-size competitor assumption (~5k stars); the star cursor resumes across
// runs if a repo exceeds it. Commits stay on the incremental window — they
// are a weight-0 employee signal (#23), not prospect signal.
const BACKFILL_MAX_PAGES = 60;
const BACKFILL_PR_MAX_PAGES = 20;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
```

(c) `queueEnrichment` gains a competitor flag:

```ts
function queueEnrichment(
  db: ReturnType<typeof getDb>,
  login: string,
  eventType: EngagementEventType,
  competitor: boolean
) {
  // Own-repo users always outrank competitor-repo users in the queue; the
  // MAX() upsert lifts anyone who later engages our own repos.
  const priority = ENRICHMENT_PRIORITY[eventType] + (competitor ? COMPETITOR_PRIORITY_OFFSET : 0);
  db.insert(enrichmentQueue)
    .values({ userLogin: login, priority, status: "pending" })
    .onConflictDoUpdate({
      target: [enrichmentQueue.userLogin],
      set: {
        priority: sql`MAX(${enrichmentQueue.priority}, ${priority})`,
        status: sql`CASE WHEN ${enrichmentQueue.status} = 'done' THEN 'done' ELSE 'pending' END`,
      },
    })
    .run();
}
```

(d) In the repo loop, after `const name = repo.name;`:

```ts
    const isCompetitor = repo.competitor != null;
    const backfill = isCompetitor && !getCursor(db, "backfilled", repo.id);
    const listMaxPages = backfill ? BACKFILL_MAX_PAGES : MAX_PAGES_PER_ENDPOINT;
    console.log(
      `[engagement] Collecting ${owner}/${name}...${backfill ? " (competitor full-history backfill)" : ""}`
    );
```

(replace the existing `console.log(\`[engagement] Collecting ${owner}/${name}...\`);`)

(e) Stars: `maxPages: MAX_PAGES_PER_ENDPOINT` → `maxPages: listMaxPages`; the `queueEnrichment` call gains `isCompetitor`:

```ts
      for await (const page of client.stargazerPages(owner, name, {
        startPage: starPage,
        maxPages: listMaxPages,
      })) {
        for (const s of page.items) {
          const userId = ensureUser(db, s.user.login, s.user.id, s.user.avatar_url);
          recordEvent(db, repo.id, userId, "star", s.starred_at?.split("T")[0] || null, "star");
          queueEnrichment(db, s.user.login, "star", isCompetitor);
          starCount++;
        }
        setCursor(db, "stargazers", repo.id, page.isLast ? "1" : String(page.page + 1));
      }
```

(f) Forks: `{ maxPages: MAX_PAGES_PER_ENDPOINT }` → `{ maxPages: listMaxPages }`; `queueEnrichment(db, f.owner.login, "fork", isCompetitor);`

(g) Issues: the since default becomes backfill-aware; enqueue gains the flag:

```ts
    const issueSince =
      getCursor(db, "issues_since", repo.id) ||
      (backfill ? EPOCH_ISO : new Date(Date.now() - 90 * 86400000).toISOString());
```

and inside the loop: `queueEnrichment(db, i.user.login, "issue", isCompetitor);`

(h) PRs: `{ maxPages: 3 }` → `{ maxPages: backfill ? BACKFILL_PR_MAX_PAGES : 3 }`; `queueEnrichment(db, p.user.login, "pr", isCompetitor);`

(i) Commits: window unchanged; `queueEnrichment(db, c.author.login, "commit", isCompetitor);`

(j) At the very end of the repo loop (after the commits block's final `console.log`):

```ts
    if (backfill) setCursor(db, "backfilled", repo.id, "1");
```

- [ ] **Step 4: Run both engagement suites**

Run: `npx vitest run src/lib/collectors/github-engagement-backfill.test.ts src/lib/collectors/github-engagement.test.ts`
Expected: PASS (3 + 2 tests) — the original suite still passes (own repos: identical behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collectors/github-engagement.ts src/lib/collectors/github-engagement-backfill.test.ts
git commit -m "feat: full-history backfill on competitor repos; competitor users enqueue below own"
```

---

### Task 5: Scoring — weight table per repo, scope stamping, dual aggregates

**Files:**
- Rewrite: `src/lib/collectors/company-scoring.ts`
- Create: `src/lib/collectors/company-scoring.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/collectors/company-scoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-scoring-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { scoreCompanies } = await import("./company-scoring");
const { todayIso } = await import("../dates");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);

run("INSERT INTO tracked_repos (owner, name) VALUES ('us', 'own-repo')");
run("INSERT INTO tracked_repos (owner, name, competitor) VALUES ('them', 'rival-repo', 'Acme')");
const ownRepoId = (sqlite.prepare("SELECT id FROM tracked_repos WHERE name='own-repo'").get() as { id: number }).id;
const rivalRepoId = (sqlite.prepare("SELECT id FROM tracked_repos WHERE name='rival-repo'").get() as { id: number }).id;

run("INSERT INTO github_users (login) VALUES ('u1')");
run("INSERT INTO github_users (login) VALUES ('u2')");
const u1 = (sqlite.prepare("SELECT id FROM github_users WHERE login='u1'").get() as { id: number }).id;
const u2 = (sqlite.prepare("SELECT id FROM github_users WHERE login='u2'").get() as { id: number }).id;

run("INSERT INTO companies (name, domain) VALUES ('Globex', 'globex.com')");
const companyId = (sqlite.prepare("SELECT id FROM companies WHERE name='Globex'").get() as { id: number }).id;
run("INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')", u1, companyId);
run("INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')", u2, companyId);

const event = (repoId: number, userId: number, type: string, eventId: string) =>
  run(
    "INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id) VALUES (?, ?, ?, ?)",
    repoId,
    userId,
    type,
    eventId
  );

// Own repo: u1 star (1) + commit (10); u2 issue (3) → 2 users → 14 + 2*2 = 18
event(ownRepoId, u1, "star", "star");
event(ownRepoId, u1, "commit", "sha1");
event(ownRepoId, u2, "issue", "issue-1");
// Competitor repo: u1 issue (8); u2 commit (weight 0 → not a scoring user) → 8 + 1*2 = 10
event(rivalRepoId, u1, "issue", "issue-9");
event(rivalRepoId, u2, "commit", "sha2");

describe("scoreCompanies with competitor attribution", () => {
  it("applies the weight table per repo and writes scoped per-repo + aggregate rows", async () => {
    await scoreCompanies();
    const today = todayIso();

    const repoRow = (repoId: number) =>
      sqlite
        .prepare(
          "SELECT scope, score, user_count, commit_count FROM company_scores WHERE company_id = ? AND repo_id = ? AND date = ?"
        )
        .get(companyId, repoId, today) as {
        scope: string;
        score: number;
        user_count: number;
        commit_count: number;
      };

    const own = repoRow(ownRepoId);
    expect(own.scope).toBe("own");
    expect(own.score).toBe(18); // 1 + 10 + 3 + 2 users × 2 breadth — unchanged math
    expect(own.user_count).toBe(2);

    const rival = repoRow(rivalRepoId);
    expect(rival.scope).toBe("competitor");
    expect(rival.score).toBe(10); // issue 8 + 1 scoring user × 2; commit contributes 0
    expect(rival.user_count).toBe(1); // weight-0-only user doesn't count
    expect(rival.commit_count).toBe(1); // …but the fact is still recorded

    const aggregates = sqlite
      .prepare(
        "SELECT scope, score FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND date = ? ORDER BY scope"
      )
      .all(companyId, today) as Array<{ scope: string; score: number }>;
    expect(aggregates).toEqual([
      { scope: "competitor", score: 10 },
      { scope: "own", score: 18 },
    ]);
  });

  it("re-running the same day replaces aggregates instead of duplicating them", async () => {
    await scoreCompanies();
    await scoreCompanies();
    const count = (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM company_scores WHERE company_id = ? AND repo_id IS NULL AND date = ?"
        )
        .get(companyId, todayIso()) as { n: number }
    ).n;
    expect(count).toBe(2); // exactly one own + one competitor — the NULL-repo dup bug is fixed
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/collectors/company-scoring.test.ts`
Expected: FAIL — no `scope` in rows (insert doesn't set it / old single aggregate uses own weights for the competitor repo; the dup test sees 3+ rows).

- [ ] **Step 3: Rewrite the scoring step**

Replace the body of `src/lib/collectors/company-scoring.ts` with:

```ts
import { getDb } from "../db/client";
import {
  companies, githubUserCompanies, githubEngagementEvents, companyScores, trackedRepos,
} from "../db/schema";
import {
  ENGAGEMENT_WEIGHTS, COMPETITOR_ENGAGEMENT_WEIGHTS, BREADTH_BONUS_PER_USER, MAX_EVENTS_PER_TYPE,
} from "../types/scoring";
import { sql } from "drizzle-orm";
import type { EngagementEventType } from "../types/sales-intelligence";
import { todayIso } from "../dates";

type ScoreScope = "own" | "competitor";

interface ScopeTotals {
  score: number;
  users: number;
  stars: number;
  forks: number;
  issues: number;
  prs: number;
  commits: number;
}

const emptyTotals = (): ScopeTotals => ({
  score: 0, users: 0, stars: 0, forks: 0, issues: 0, prs: 0, commits: 0,
});

export async function scoreCompanies() {
  const db = getDb();
  const today = todayIso();
  const allCompanies = db.select().from(companies).all();
  const allRepos = db.select().from(trackedRepos).all();

  let scored = 0;

  for (const company of allCompanies) {
    // Get all users linked to this company
    const userLinks = db.select().from(githubUserCompanies)
      .where(sql`${githubUserCompanies.companyId} = ${company.id}`)
      .all();

    if (userLinks.length === 0) continue;
    const userIds = userLinks.map((u) => u.userId);

    // Two aggregates that never blend: own-engagement and competitor-engagement
    const totals: Record<ScoreScope, ScopeTotals> = {
      own: emptyTotals(),
      competitor: emptyTotals(),
    };

    for (const repo of allRepos) {
      // Signal semantics flip on competitor repos — the weight table is
      // selected per repo from its attribution.
      const scope: ScoreScope = repo.competitor ? "competitor" : "own";
      const weights = repo.competitor ? COMPETITOR_ENGAGEMENT_WEIGHTS : ENGAGEMENT_WEIGHTS;

      let repoScore = 0;
      let repoUsers = 0;
      let repoStars = 0, repoForks = 0, repoIssues = 0, repoPrs = 0, repoCommits = 0;

      for (const userId of userIds) {
        const events = db.select({
          eventType: githubEngagementEvents.eventType,
          count: sql<number>`COUNT(*)`,
        })
          .from(githubEngagementEvents)
          .where(sql`${githubEngagementEvents.userId} = ${userId} AND ${githubEngagementEvents.repoId} = ${repo.id}`)
          .groupBy(githubEngagementEvents.eventType)
          .all();

        if (events.length === 0) continue;

        let userScore = 0;
        for (const e of events) {
          const type = e.eventType as EngagementEventType;
          const weight = weights[type] || 0;
          const capped = Math.min(e.count, MAX_EVENTS_PER_TYPE);
          userScore += capped * weight;

          // Track type counts (facts, recorded regardless of weight)
          if (type === "star") repoStars += capped;
          else if (type === "fork") repoForks += capped;
          else if (type === "issue" || type === "issue_comment") repoIssues += capped;
          else if (type === "pr" || type === "pr_review") repoPrs += capped;
          else if (type === "commit") repoCommits += capped;
        }
        // Only score-carrying users count toward breadth — on own repos this
        // is a no-op (every own weight ≥ 1); on competitor repos it keeps
        // supply-signal-only users (commits/PRs — the competitor's own team)
        // from inflating prospect scores via the breadth bonus.
        if (userScore > 0) repoUsers++;
        repoScore += userScore;
      }

      if (repoUsers > 0) {
        repoScore += repoUsers * BREADTH_BONUS_PER_USER;

        // Save per-repo score (scope stamped from the repo's attribution)
        db.insert(companyScores)
          .values({
            companyId: company.id, repoId: repo.id, scope, date: today,
            score: repoScore, userCount: repoUsers,
            starCount: repoStars, forkCount: repoForks,
            issueCount: repoIssues, prCount: repoPrs, commitCount: repoCommits,
          })
          .onConflictDoUpdate({
            target: [companyScores.companyId, companyScores.repoId, companyScores.date],
            set: {
              scope: sql`excluded.scope`,
              score: sql`excluded.score`, userCount: sql`excluded.user_count`,
              starCount: sql`excluded.star_count`, forkCount: sql`excluded.fork_count`,
              issueCount: sql`excluded.issue_count`, prCount: sql`excluded.pr_count`,
              commitCount: sql`excluded.commit_count`,
            },
          })
          .run();
      }

      const t = totals[scope];
      t.score += repoScore;
      t.users = Math.max(t.users, repoUsers);
      t.stars += repoStars; t.forks += repoForks;
      t.issues += repoIssues; t.prs += repoPrs; t.commits += repoCommits;
    }

    // Aggregate rows (repo_id NULL): delete-then-insert. SQLite treats NULLs
    // as distinct in the (company_id, repo_id, date) unique index, so the old
    // upsert never conflicted and same-day re-runs duplicated aggregates —
    // replacing the day's rows fixes that and gives one row per scope.
    if (totals.own.score > 0 || totals.competitor.score > 0) {
      db.delete(companyScores)
        .where(
          sql`${companyScores.companyId} = ${company.id} AND ${companyScores.repoId} IS NULL AND ${companyScores.date} = ${today}`
        )
        .run();
      for (const scope of ["own", "competitor"] as const) {
        const t = totals[scope];
        if (t.score <= 0) continue;
        db.insert(companyScores)
          .values({
            companyId: company.id, repoId: null, scope, date: today,
            score: t.score, userCount: t.users,
            starCount: t.stars, forkCount: t.forks,
            issueCount: t.issues, prCount: t.prs, commitCount: t.commits,
          })
          .run();
      }
      scored++;
    }
  }

  console.log(`[scoring] Scored ${scored} companies`);
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/lib/collectors/company-scoring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collectors/company-scoring.ts src/lib/collectors/company-scoring.test.ts
git commit -m "feat: dual-scope company scoring with competitor weight table; fix NULL-repo aggregate duplication"
```

---

### Task 6: Alerts evaluator — pin own scope

**Files:**
- Modify: `src/lib/collectors/alerts-evaluator.ts:31,73`
- Create: `src/lib/collectors/alerts-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/collectors/alerts-evaluator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-alerts-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { evaluateAlerts } = await import("./alerts-evaluator");
const { todayIso } = await import("../dates");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    `INSERT INTO alert_rules (name, rule_type, config, enabled, notify_slack)
     VALUES ('hot', 'score_threshold', '{"min_score":15,"min_users":1}', 1, 0)`
  )
  .run();
sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Rivalfan', 'rivalfan.io')").run();
sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Hotlead', 'hotlead.io')").run();
const rivalfan = (sqlite.prepare("SELECT id FROM companies WHERE name='Rivalfan'").get() as { id: number }).id;
const hotlead = (sqlite.prepare("SELECT id FROM companies WHERE name='Hotlead'").get() as { id: number }).id;

const today = todayIso();
const score = (companyId: number, scope: string, score: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count) VALUES (?, NULL, ?, ?, ?, 3)"
    )
    .run(companyId, scope, today, score);

// Rivalfan: prospect — big COMPETITOR score, tiny own. Must NOT fire an
// own-engagement alert (competitor rule types are #24's work).
score(rivalfan, "competitor", 80);
score(rivalfan, "own", 4);
// Hotlead: genuinely hot on OUR repos → fires.
score(hotlead, "own", 40);

describe("evaluateAlerts with scoped aggregates", () => {
  it("score_threshold reads own-scope aggregates only", async () => {
    await evaluateAlerts();
    const alerts = sqlite
      .prepare("SELECT company_id FROM alert_events ORDER BY company_id")
      .all() as Array<{ company_id: number }>;
    expect(alerts.map((a) => a.company_id)).toEqual([hotlead]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/collectors/alerts-evaluator.test.ts`
Expected: FAIL — Rivalfan's competitor-scope 80 also qualifies, so both companies fire.

- [ ] **Step 3: Pin the scope in both aggregate reads**

In `src/lib/collectors/alerts-evaluator.ts`, the `score_threshold` query's where (line ~30) becomes:

```ts
        .where(sql`
          ${companyScores.repoId} IS NULL
          AND ${companyScores.scope} = 'own'
          AND ${companyScores.date} = ${today}
          AND ${companyScores.score} >= ${minScore}
          AND ${companyScores.userCount} >= ${minUsers}
        `)
```

and the `engagement_spike` current-rows query (line ~73):

```ts
        .where(sql`${companyScores.repoId} IS NULL AND ${companyScores.scope} = 'own' AND ${companyScores.date} = ${today}`)
```

and its prev-score query (line ~79):

```ts
          .where(sql`
            ${companyScores.companyId} = ${c.companyId}
            AND ${companyScores.repoId} IS NULL
            AND ${companyScores.scope} = 'own'
            AND ${companyScores.date} <= ${compareDate}
          `)
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/lib/collectors/alerts-evaluator.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collectors/alerts-evaluator.ts src/lib/collectors/alerts-evaluator.test.ts
git commit -m "fix: alert rules evaluate own-scope aggregates only (competitor rules land in #24)"
```

---

### Task 7: Contract types — dual scores + segment

**Files:**
- Modify: `src/lib/types/sales-intelligence.ts` (CompanySummary)
- Modify: `src/lib/types/api.ts` (re-export)

- [ ] **Step 1: Extend CompanySummary**

In `src/lib/types/sales-intelligence.ts`, `CompanySummary` becomes:

```ts
export interface CompanySummary {
  id: number;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: string | null;
  /** Own-engagement aggregate — same meaning as before dual scoring. */
  score: number;
  /** Competitor-engagement aggregate; 0 when the company has none. */
  competitorScore: number;
  /** Derived at query time from the two aggregates (PRD #17 matrix). */
  segment: CompanySegment;
  userCount: number;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
  scoreTrend: number; // change vs 7 days ago (own score)
}
```

(`CompanyDetail extends Omit<CompanySummary, "scoreTrend">` — it inherits both new fields automatically.)

- [ ] **Step 2: Re-export the segment type**

In `src/lib/types/api.ts`, the sales-intelligence re-export block gains `CompanySegment`:

```ts
export type {
  CompanySummary,
  CompanyDetail,
  CompanySegment,
  FiredAlert,
  AlertRuleType,
} from "./sales-intelligence";
```

- [ ] **Step 3: Commit** (routes don't compile against the new fields yet — that's the next two tasks; the type-only change is safe)

```bash
git add src/lib/types/sales-intelligence.ts src/lib/types/api.ts
git commit -m "feat: dual scores + segment on the companies contract"
```

Note: `npm run build` would fail BETWEEN this commit and Task 8 (the routes' payload consts no longer satisfy the contract) — Tasks 7–9 land as a unit before any full verification.

---

### Task 8: Companies list route — dual scores, segment, duplicate-proof reads

**Files:**
- Modify: `src/app/api/companies/route.ts`
- Create: `src/app/api/companies/route.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/app/api/companies/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { CompanySummary } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-companies-route-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { todayIso } = await import("@/lib/dates");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
const addCompany = (name: string) => {
  sqlite.prepare("INSERT INTO companies (name, domain) VALUES (?, ?)").run(name, `${name}.io`);
  return (sqlite.prepare("SELECT id FROM companies WHERE name = ?").get(name) as { id: number }).id;
};
const today = todayIso();
const aggregate = (companyId: number, scope: string, score: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count, star_count, fork_count, issue_count, pr_count, commit_count) VALUES (?, NULL, ?, ?, ?, 2, 1, 0, 1, 0, 0)"
    )
    .run(companyId, scope, today, score);

const engagedCo = addCompany("engaged-co");
aggregate(engagedCo, "own", 30);

const battlegroundCo = addCompany("battleground-co");
aggregate(battlegroundCo, "own", 20);
aggregate(battlegroundCo, "competitor", 15);

const prospectCo = addCompany("prospect-co");
aggregate(prospectCo, "competitor", 25);

describe("GET /api/companies (seeded temp DB)", () => {
  it("returns dual scores and derived segments, ordered by the stronger signal", async () => {
    const res = await GET(new NextRequest("http://localhost/api/companies"));
    const body = (await res.json()) as CompanySummary[];

    expect(res.status).toBe(200);
    expect(body.map((c) => c.name)).toEqual(["engaged-co", "prospect-co", "battleground-co"]);

    const byName = Object.fromEntries(body.map((c) => [c.name, c]));
    expect(byName["engaged-co"]).toMatchObject({ score: 30, competitorScore: 0, segment: "engaged" });
    expect(byName["battleground-co"]).toMatchObject({ score: 20, competitorScore: 15, segment: "battleground" });
    expect(byName["prospect-co"]).toMatchObject({ score: 0, competitorScore: 25, segment: "prospect" });

    // exactly the contract keys
    expect(Object.keys(body[0]).sort()).toEqual(
      [
        "id", "name", "domain", "website", "industry", "employeeCount",
        "score", "competitorScore", "segment", "userCount",
        "starCount", "forkCount", "issueCount", "prCount", "commitCount", "scoreTrend",
      ].sort()
    );
  });

  it("minScore filters on the stronger of the two scores", async () => {
    const res = await GET(new NextRequest("http://localhost/api/companies?minScore=24"));
    const body = (await res.json()) as CompanySummary[];
    expect(body.map((c) => c.name)).toEqual(["engaged-co", "prospect-co"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/companies/route.test.ts`
Expected: FAIL — no `competitorScore`/`segment` in the payload; prospect-co (own row absent) is missing entirely.

- [ ] **Step 3: Rewrite the list route**

Replace `src/app/api/companies/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { companies, companyScores } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { daysAgoIso } from "@/lib/dates";
import { deriveSegment } from "@/lib/segments";
import type { CompanySummary } from "@/lib/types/api";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");
  const minScore = parseFloat(searchParams.get("minScore") || "0");

  const db = getDb();
  const sevenDaysAgo = daysAgoIso(7);

  // Latest aggregate per scope. `id DESC` tiebreaks the pre-scope duplicate
  // aggregate rows (NULL repo_id never hit the unique index) deterministically.
  const latestAggregate = (companyId: number, scope: "own" | "competitor") =>
    db
      .select()
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = ${scope}`
      )
      .orderBy(desc(companyScores.date), desc(companyScores.id))
      .limit(1)
      .get();

  const allCompanies = db.select().from(companies).all();
  const summaries: CompanySummary[] = [];

  for (const company of allCompanies) {
    const own = latestAggregate(company.id, "own");
    const competitor = latestAggregate(company.id, "competitor");
    if (!own && !competitor) continue;

    const ownScore = own?.score || 0;
    const competitorScore = competitor?.score || 0;
    if (Math.max(ownScore, competitorScore) < minScore) continue;

    // Trend stays own-based — same meaning as before dual scoring.
    const prevScore = db
      .select({ score: companyScores.score })
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${company.id} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = 'own' AND ${companyScores.date} <= ${sevenDaysAgo}`
      )
      .orderBy(desc(companyScores.date), desc(companyScores.id))
      .limit(1)
      .get();

    summaries.push({
      id: company.id,
      name: company.name,
      domain: company.domain,
      website: company.website,
      industry: company.industry,
      employeeCount: company.employeeCount,
      score: ownScore,
      competitorScore,
      segment: deriveSegment(ownScore, competitorScore),
      userCount: own?.userCount || 0,
      starCount: own?.starCount || 0,
      forkCount: own?.forkCount || 0,
      issueCount: own?.issueCount || 0,
      prCount: own?.prCount || 0,
      commitCount: own?.commitCount || 0,
      scoreTrend: own && prevScore ? own.score - prevScore.score : 0,
    });
  }

  // The stronger signal wins the default ordering so net-new prospects
  // surface next to hot own-engagement companies.
  summaries.sort(
    (a, b) => Math.max(b.score, b.competitorScore) - Math.max(a.score, a.competitorScore)
  );

  return NextResponse.json(summaries.slice(offset, offset + limit));
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/app/api/companies/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/companies/route.ts src/app/api/companies/route.test.ts
git commit -m "feat: companies list carries dual scores and derived segment"
```

---

### Task 9: Companies detail route — dual scores + own-scoped history

**Files:**
- Modify: `src/app/api/companies/[id]/route.ts`
- Create: `src/app/api/companies/[id]/route.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/app/api/companies/[id]/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { CompanyDetail } from "@/lib/types/api";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-company-detail-test-")),
  "test.db"
);

const { runMigrations } = await import("@/lib/db/migrate");
const { todayIso, daysAgoIso } = await import("@/lib/dates");
const { GET } = await import("./route");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite.prepare("INSERT INTO companies (name, domain) VALUES ('Globex', 'globex.com')").run();
const companyId = (sqlite.prepare("SELECT id FROM companies WHERE name='Globex'").get() as { id: number }).id;

const aggregate = (scope: string, date: string, score: number) =>
  sqlite
    .prepare(
      "INSERT INTO company_scores (company_id, repo_id, scope, date, score, user_count) VALUES (?, NULL, ?, ?, ?, 2)"
    )
    .run(companyId, scope, date, score);

aggregate("own", daysAgoIso(3), 12);
aggregate("own", todayIso(), 20);
aggregate("competitor", todayIso(), 15);

const request = (id: number) =>
  GET(new NextRequest(`http://localhost/api/companies/${id}`), {
    params: Promise.resolve({ id: String(id) }),
  });

describe("GET /api/companies/[id] (seeded temp DB)", () => {
  it("carries dual scores, segment, and an own-only score history", async () => {
    const res = await request(companyId);
    const body = (await res.json()) as CompanyDetail;

    expect(res.status).toBe(200);
    expect(body.score).toBe(20);
    expect(body.competitorScore).toBe(15);
    expect(body.segment).toBe("battleground");
    // competitor aggregates must NOT leak into the own-score history chart
    expect(body.scoreHistory).toEqual([
      { date: daysAgoIso(3), score: 12 },
      { date: todayIso(), score: 20 },
    ]);
  });

  it("404s for an unknown company", async () => {
    const res = await request(99999);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/app/api/companies/[id]/route.test.ts"`
Expected: FAIL — no `competitorScore`/`segment`; history contains 3 entries (the competitor row leaks).

- [ ] **Step 3: Update the detail route**

In `src/app/api/companies/[id]/route.ts`:

(a) Import the transform (after the drizzle import):

```ts
import { sql, desc } from "drizzle-orm";
import { deriveSegment } from "@/lib/segments";
```

(b) Replace the latest-score block (lines ~22-29) with scope-aware reads:

```ts
  // Latest aggregate per scope (`id DESC` tiebreaks legacy duplicate rows)
  const latestAggregate = (scope: "own" | "competitor") =>
    db
      .select()
      .from(companyScores)
      .where(
        sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = ${scope}`
      )
      .orderBy(desc(companyScores.date), desc(companyScores.id))
      .limit(1)
      .get();
  const latestScore = latestAggregate("own");
  const latestCompetitorScore = latestAggregate("competitor");
```

(c) Scope the history query (line ~35):

```ts
    .where(
      sql`${companyScores.companyId} = ${companyId} AND ${companyScores.repoId} IS NULL AND ${companyScores.scope} = 'own'`
    )
```

(d) Extend the payload:

```ts
  const ownScore = latestScore?.score || 0;
  const competitorScore = latestCompetitorScore?.score || 0;
  const payload: CompanyDetail = {
    ...company,
    score: ownScore,
    competitorScore,
    segment: deriveSegment(ownScore, competitorScore),
    userCount: latestScore?.userCount || 0,
    starCount: latestScore?.starCount || 0,
    forkCount: latestScore?.forkCount || 0,
    issueCount: latestScore?.issueCount || 0,
    prCount: latestScore?.prCount || 0,
    commitCount: latestScore?.commitCount || 0,
    scoreHistory,
    users,
  };
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run "src/app/api/companies/[id]/route.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/companies/[id]/route.ts" "src/app/api/companies/[id]/route.test.ts"
git commit -m "feat: company detail carries dual scores + segment; history stays own-scoped"
```

---

### Task 10: CLAUDE.md conventions

- [ ] **Step 1: Document the scoring-scope conventions**

In `CLAUDE.md`, append to the competitor paragraph in "Configuration flow" (added by #18):

```markdown
Scoring: `company_scores` carries a `scope` discriminator (`own` |
`competitor`) — per-repo rows are stamped from the repo's attribution, and
aggregate rows (`repo_id IS NULL`) are written one-per-scope via
delete-then-insert (the NULL repo_id never hits the unique index, so upserts
would duplicate). The weight table is selected per repo
(`COMPETITOR_ENGAGEMENT_WEIGHTS`: issues high, forks medium, stars low,
commits/PRs 0 — supply signals identify employees, not prospects). Segments
(engaged / battleground / prospect) are derived at query time via
`src/lib/segments.ts`, never stored. Aggregate reads (companies API, alert
rules) must pin a scope — own-engagement semantics never blend with
competitor engagement.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: dual-scope scoring conventions in CLAUDE.md"
```

---

### Task 11: Full verification + scripted end-to-end demo

The issue's demo: *run the pipeline with a competitor repo configured — the companies API returns companies with dual scores and segments, including net-new prospects discovered only via the competitor.* Run it deterministically against a **copy** of the dev DB: real config-sync-shaped data + synthetic competitor engagement + the real scoring step + the real API.

- [ ] **Step 1: Full suite, lint, build**

```bash
npm test && npm run lint && npm run build
```
Expected: all green (lint: only the 4 pre-existing warnings).

- [ ] **Step 2: Prepare the demo DB copy and seed competitor engagement**

```bash
cp data/gtm-tracker.db /tmp/demo19.db
DATABASE_PATH=/tmp/demo19.db npm run db:migrate
```

Create `.demo19-seed.ts` (in-repo scratch, deleted after):

```ts
import Database from "better-sqlite3";
import { scoreCompanies } from "./src/lib/collectors/company-scoring";

const db = new Database(process.env.DATABASE_PATH!);
db.prepare("INSERT INTO tracked_repos (owner, name, competitor) VALUES ('demo-rival', 'demo-repo', 'DemoRival')").run();
const repoId = (db.prepare("SELECT id FROM tracked_repos WHERE name='demo-repo'").get() as { id: number }).id;
db.prepare("INSERT INTO github_users (login) VALUES ('demo-prospect-dev')").run();
const userId = (db.prepare("SELECT id FROM github_users WHERE login='demo-prospect-dev'").get() as { id: number }).id;
db.prepare("INSERT INTO companies (name, domain) VALUES ('DemoProspect Inc', 'demoprospect.example')").run();
const companyId = (db.prepare("SELECT id FROM companies WHERE name='DemoProspect Inc'").get() as { id: number }).id;
db.prepare("INSERT INTO github_user_companies (user_id, company_id, source) VALUES (?, ?, 'email_domain')").run(userId, companyId);
db.prepare("INSERT INTO github_engagement_events (repo_id, user_id, event_type, github_event_id) VALUES (?, ?, 'issue', 'issue-1')").run(repoId, userId);
db.close();

await scoreCompanies();
console.log("demo seed + scoring done");
```

```bash
DATABASE_PATH=/tmp/demo19.db npx tsx .demo19-seed.ts
```

- [ ] **Step 3: Verify via the real API**

```bash
DATABASE_PATH=/tmp/demo19.db npm run dev   # background; wait for ready
curl -s "http://localhost:3000/api/companies" | python3 -m json.tool
```
Expected: `DemoProspect Inc` appears with `score: 0`, `competitorScore: 10` (issue 8 + breadth 2), `segment: "prospect"`; every pre-existing company carries `competitorScore: 0`, `segment: "engaged"`, own scores intact. Also spot-check a detail: `curl -s http://localhost:3000/api/companies/<demo-id>` → battleground matrix fields present, history own-only.

- [ ] **Step 4: Tear down completely**

```bash
# stop the dev server first
rm -f /tmp/demo19.db .demo19-seed.ts
git status   # clean apart from committed work; dev DB untouched
```

---

### Task 12: PR + merge (standing authorization)

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/competitor-scoring
gh pr create --title "Competitor engagement collection, dual company scores, and segments in the companies API" --body "<per-AC table — see template in plan>"
```

PR body must include: per-AC verification table (6 ACs), the latent NULL-repo duplicate-aggregate bug fix (with production evidence: triplicate rows for 2026-06-03), competitor weight values chosen (PRD gave ordering only), commits-stay-incremental backfill choice, list-ordering/minScore now on max(own, competitor), alerts pinned to own scope ahead of #24.

- [ ] **Step 2: Merge after green verification (Will's standing authorization for this series)**

```bash
gh pr merge <n> --merge --delete-branch
git checkout main && git pull --ff-only   # if gh didn't already fast-forward
```

Confirm issue #19 auto-closed.

---

## Self-Review

1. **AC coverage:** backfill-with-fake-client → Task 4; enrichment flow + queue priority → Task 4 (priority tests; enrichment/resolution chain untouched by design — competitor users enter the same queue/tables); weight table per repo → Tasks 3+5; separate aggregates + own behavior unchanged → Task 5 (own math asserted = legacy values) + Task 6 (alerts pinned); API payload + contract → Tasks 7–9; segment matrix → Task 3 unit tests + Tasks 8/9 route tests. Demo → Task 11.
2. **Placeholder scan:** all code steps show full code; the PR body step references the named deviations explicitly.
3. **Type consistency:** `scope` values `'own' | 'competitor'` everywhere (schema enum, ScoreScope, route reads, test seeds); `CompanySegment` `"engaged" | "battleground" | "prospect"` in type, transform, and tests; `COMPETITOR_PRIORITY_OFFSET` −100 matches test expectations (−99/−97); `deriveSegment(own, competitor)` argument order consistent across both routes and tests.
