# Competitor Reverse-Dependency → Company Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve competitor-package reverse dependencies to companies as a high-intent "ships code on the competitor" signal (GitHub issue #22, parent PRD #17): the one new pipeline step, feeding the competitor score with a high weight and surfacing in detail attribution.

**Architecture:** deps.dev dependents are **packages**, not repos — the chain is dependent package → source repo (deps.dev `GetVersion.relatedProjects`, label `SOURCE_REPO`) → owning GitHub org → company. A new `company_competitor_signals` table records one row per (company, competitor package, dependent) with a UNIQUE constraint for idempotency. The step (`resolve-competitor-dependents`) takes two injected seams: a `getPackageSourceRepo` function (new, on the deps-dev client, with a `fetchImpl` test seam) and the existing `GithubClient` (org profile → website domain → company, mirroring company-resolution's org path; name fallback). Scoring adds `DEPENDS_ON_WEIGHT` (12 — above issues' 8, per the PRD: "dependents rank alongside (and above) issue-filers") × per-package capped signal count to the competitor aggregate — so depends-on-only companies become prospects and segments update automatically. The detail attribution gains depends-on rows (`signal: "depends_on"`, `dependentCount`), phrased "ships code on Pinata: 2 dependent repos use pinata-js".

**Tech Stack:** drizzle migration `0003` (new table — additive CREATE), injected-client step test per prior art, Vitest.

**Key facts pinned:**
- **Pipeline wiring**: `resolve-competitor-dependents` dependsOn `["config-sync"]` only — it reads whatever `reverse_dependencies` exist (they persist across runs), so a flaky deps.dev day does NOT skip the scoring chain; `company-scoring` dependsOn gains the new step (ordering + the AC's failure-isolation semantics: step fails → scoring/alerts/slack skip). In-practice ordering still puts `deps-dev` before it (registry order for independents). Trade-off (freshness lag ≤ 1 day for brand-new dependents vs daily-chain resilience) documented in the PR.
- Signals accumulate (firstSeen-stamped, unique on company+package+dependent); re-runs are `onConflictDoNothing`.
- Scoring caps signal count per package at `MAX_EVENTS_PER_TYPE` (5), consistent with engagement caps.
- The competitor's own company never links here (signals attach to *dependent* owners), and employee exclusion is #23 — no interaction.
- `CompetitorAttributionRow` gains `signal: "engagement" | "depends_on"` + `dependentCount: number` — #21's exact-equality route test gets the two new fields added.
- Unresolvable dependents (no source repo, non-github repo, org profile 404, freemail domain → name fallback fails) are **skipped per-dependent** inside try/catch — the step never fails on data quality (AC).
- deps.dev `GetVersion` URL: `/systems/{system}/packages/{pkg}/versions/{version}`; when the stored `dependentVersion` is null, fall back to `getPackageInfo`'s `isDefault` version. Parse `relatedProjects[].{projectKey.id, relationType==="SOURCE_REPO"}` with `links[].{label==="SOURCE_REPO", url}` fallback; only `github.com/{owner}/{repo}` ids count.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-competitor-reverse-deps.md` | Create | This plan |
| `src/lib/db/schema.ts` | Modify | `companyCompetitorSignals` table |
| `drizzle/0003_*.sql` + meta | Generate | The migration |
| `src/lib/db/migrate.test.ts` | Modify | Table-exists assertion |
| `src/lib/api-clients/deps-dev-client.ts` | Modify | `getPackageSourceRepo` (fetchImpl seam) |
| `src/lib/api-clients/deps-dev-client.test.ts` | Create | Parse/fallback/404 tests |
| `src/lib/types/scoring.ts` | Modify | `DEPENDS_ON_WEIGHT = 12` |
| `src/lib/collectors/competitor-dependents.ts` | Create | The step |
| `src/lib/collectors/competitor-dependents.test.ts` | Create | DB-backed step test (injected fns) |
| `src/lib/pipeline/definition.ts` + `definition.test.ts` | Modify | Step registration (15 steps) |
| `src/lib/collectors/company-scoring.ts` + `.test.ts` | Modify | Depends-on contribution to competitor aggregate |
| `src/lib/types/sales-intelligence.ts` | Modify | `signal` + `dependentCount` on attribution rows |
| `src/app/api/companies/[id]/route.ts` + `.test.ts` | Modify | Depends-on attribution rows |
| `src/app/companies/transforms.ts` + `.test.ts` | Modify | `formatDependentCount` |
| `src/app/companies/[id]/page.tsx` | Modify | Depends-on phrasing |
| `CLAUDE.md` | Modify | Step + signal conventions |

---

### Task 1: Branch + plan

```bash
git checkout -b feat/competitor-reverse-deps
git add docs/superpowers/plans/2026-06-03-competitor-reverse-deps.md
git commit -m "docs: implementation plan for competitor reverse-dep resolution (#22)"
```

---

### Task 2: Signals table + migration

- [ ] **Step 1: Failing migrate-gate assertion** — append in the upgrade-path describe:

```ts
  it("the migrations add the competitor-signals table", () => {
    process.env.DATABASE_PATH = path.join(tmp, "signals.db");
    runMigrations();
    const db = new Database(process.env.DATABASE_PATH);
    const cols = (db.prepare("PRAGMA table_info(company_competitor_signals)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(cols).toEqual(["id", "company_id", "package_id", "signal_type", "dependent_name", "first_seen"]);
    db.close();
  });
```

Run → FAIL (no table).

- [ ] **Step 2: Schema** — in `src/lib/db/schema.ts` after `companyScores`:

```ts
export const companyCompetitorSignals = sqliteTable(
  "company_competitor_signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    packageId: integer("package_id")
      .notNull()
      .references(() => trackedPackages.id),
    signalType: text("signal_type", { enum: ["depends_on"] })
      .notNull()
      .default("depends_on"),
    dependentName: text("dependent_name").notNull(),
    firstSeen: text("first_seen").notNull(),
  },
  (table) => [
    unique("company_competitor_signals_unique").on(
      table.companyId,
      table.packageId,
      table.dependentName
    ),
    index("idx_company_competitor_signals_company").on(table.companyId),
    check(
      "company_competitor_signals_type_check",
      sql`${table.signalType} IN ('depends_on')`
    ),
  ]
);
```

- [ ] **Step 3:** `npx drizzle-kit generate --name competitor-signals` → review (one CREATE TABLE + index, no recreations) → migrate suite green → commit:

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.test.ts drizzle/
git commit -m "feat: company_competitor_signals table for depends-on-competitor signals"
```

---

### Task 3: deps-dev client — `getPackageSourceRepo`

- [ ] **Step 1: Failing test** — create `src/lib/api-clients/deps-dev-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getPackageSourceRepo } from "./deps-dev-client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("getPackageSourceRepo", () => {
  it("resolves the SOURCE_REPO related project for a versioned dependent", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      expect(String(url)).toContain("/systems/npm/packages/acme-app/versions/1.2.3");
      return jsonResponse({
        relatedProjects: [
          { projectKey: { id: "github.com/acme/app" }, relationType: "SOURCE_REPO" },
        ],
      });
    };
    expect(await getPackageSourceRepo("npm", "acme-app", "1.2.3", fetchImpl)).toBe(
      "github.com/acme/app"
    );
  });

  it("falls back to the default version, then to SOURCE_REPO links", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/packages/acme-app")) {
        return jsonResponse({
          packageKey: { system: "NPM", name: "acme-app" },
          versions: [
            { versionKey: { system: "NPM", name: "acme-app", version: "2.0.0" }, publishedAt: "", isDefault: true },
          ],
        });
      }
      return jsonResponse({
        links: [{ label: "SOURCE_REPO", url: "https://github.com/acme/app" }],
      });
    };
    expect(await getPackageSourceRepo("npm", "acme-app", null, fetchImpl)).toBe(
      "github.com/acme/app"
    );
    expect(calls[1]).toContain("/versions/2.0.0");
  });

  it("returns null on 404s and non-github sources", async () => {
    expect(
      await getPackageSourceRepo("npm", "ghost", "1.0.0", async () => jsonResponse({}, 404))
    ).toBeNull();
    expect(
      await getPackageSourceRepo("npm", "gl", "1.0.0", async () =>
        jsonResponse({
          relatedProjects: [{ projectKey: { id: "gitlab.com/x/y" }, relationType: "SOURCE_REPO" }],
        })
      )
    ).toBeNull();
  });
});
```

Run → FAIL (not exported).

- [ ] **Step 2: Implement** — append to `src/lib/api-clients/deps-dev-client.ts`:

```ts
export interface DepsDevVersionResponse {
  relatedProjects?: Array<{ projectKey: { id: string }; relationType: string }>;
  links?: Array<{ label: string; url: string }>;
}

/** Resolve a dependent package's source repo as "github.com/owner/name" via
 *  deps.dev GetVersion (default version looked up when none is stored).
 *  Returns null for unknown packages and non-GitHub sources — callers skip
 *  those dependents. fetchImpl is the test seam. */
export async function getPackageSourceRepo(
  registry: string,
  pkg: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const system = registryToSystem(registry);
  const encodedPkg = encodeURIComponent(pkg);

  let v = version;
  if (!v) {
    const infoResp = await fetchImpl(`${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedPkg}`);
    if (!infoResp.ok) return null;
    const info: DepsDevPackageInfo = await infoResp.json();
    v = info.versions?.find((x) => x.isDefault)?.versionKey.version ?? null;
    if (!v) return null;
  }

  const resp = await fetchImpl(
    `${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedPkg}/versions/${encodeURIComponent(v)}`
  );
  if (!resp.ok) return null;
  const data: DepsDevVersionResponse = await resp.json();

  const related = data.relatedProjects?.find(
    (p) => p.relationType === "SOURCE_REPO" && p.projectKey.id.startsWith("github.com/")
  );
  if (related) return related.projectKey.id;

  const link = data.links?.find((l) => l.label === "SOURCE_REPO" && l.url.includes("github.com/"));
  if (link) {
    const m = link.url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (m) return `github.com/${m[1]}/${m[2].replace(/\.git$/, "")}`;
  }
  return null;
}
```

- [ ] **Step 3:** Green → commit:

```bash
git add src/lib/api-clients/deps-dev-client.ts src/lib/api-clients/deps-dev-client.test.ts
git commit -m "feat: deps.dev source-repo resolution for dependent packages"
```

---

### Task 4: The step

- [ ] **Step 1: Weight constant** — `src/lib/types/scoring.ts`:

```ts
/** "Ships code on the competitor" — the strongest prospect signal (PRD:
 *  dependents rank alongside, and above, issue-filers). Applied per
 *  dependent (capped per package at MAX_EVENTS_PER_TYPE) to the competitor
 *  aggregate. */
export const DEPENDS_ON_WEIGHT = 12;
```

- [ ] **Step 2: Failing step test** — create `src/lib/collectors/competitor-dependents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import type { GithubClient } from "../api-clients/github-client";

process.env.DATABASE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "gtm-compdeps-test-")),
  "test.db"
);

const { runMigrations } = await import("../db/migrate");
const { resolveCompetitorDependents } = await import("./competitor-dependents");

runMigrations();

const sqlite = new Database(process.env.DATABASE_PATH!);
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'pinata-js', 'Pinata JS', 'Pinata')"
  )
  .run();
sqlite
  .prepare("INSERT INTO tracked_packages (registry, name) VALUES ('npm', 'our-own-pkg')")
  .run();
const rivalPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='pinata-js'").get() as { id: number }
).id;
const ownPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='our-own-pkg'").get() as { id: number }
).id;
const dep = (pkgId: number, name: string, version: string | null) =>
  sqlite
    .prepare(
      "INSERT INTO reverse_dependencies (package_id, dependent_name, dependent_registry, dependent_version, first_seen) VALUES (?, ?, 'npm', ?, '2026-06-01')"
    )
    .run(pkgId, name, version);
dep(rivalPkgId, "acme-app", "1.0.0"); // resolves → org acme → acme.dev
dep(rivalPkgId, "ghost-pkg", null); // no source repo → skipped
dep(rivalPkgId, "solo-tool", "2.0.0"); // org profile 404 → skipped
dep(ownPkgId, "consumer", "1.0.0"); // own package — never touched

const repoByPkg: Record<string, string | null> = {
  "acme-app": "github.com/acme/app",
  "ghost-pkg": null,
  "solo-tool": "github.com/solodev/tool",
};
const fakeGetRepo = async (_registry: string, pkg: string) => repoByPkg[pkg] ?? null;

const fakeGithub = {
  getUserProfile: async (login: string) => {
    if (login === "acme")
      return { id: 1, login, name: "Acme Corp", blog: "https://acme.dev", email: null, company: null, bio: null, avatar_url: "", location: null, twitter_username: null };
    throw new Error("404 not found");
  },
} as unknown as GithubClient;

describe("resolveCompetitorDependents", () => {
  it("resolves dependents of competitor packages to companies and records signals", async () => {
    await resolveCompetitorDependents(fakeGetRepo, fakeGithub);

    const company = sqlite
      .prepare("SELECT id, name, domain FROM companies WHERE domain = 'acme.dev'")
      .get() as { id: number; name: string; domain: string } | undefined;
    expect(company).toBeTruthy();

    const signals = sqlite
      .prepare("SELECT company_id, package_id, signal_type, dependent_name FROM company_competitor_signals")
      .all() as Array<{ company_id: number; package_id: number; signal_type: string; dependent_name: string }>;
    expect(signals).toEqual([
      {
        company_id: company!.id,
        package_id: rivalPkgId,
        signal_type: "depends_on",
        dependent_name: "acme-app",
      },
    ]);
  });

  it("is idempotent across re-runs", async () => {
    await resolveCompetitorDependents(fakeGetRepo, fakeGithub);
    const n = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM company_competitor_signals").get() as { n: number }
    ).n;
    expect(n).toBe(1);
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/lib/collectors/competitor-dependents.ts`:

```ts
import { getDb } from "../db/client";
import {
  trackedPackages, reverseDependencies, companies, companyCompetitorSignals,
} from "../db/schema";
import { createGithubClient, type GithubClient } from "../api-clients/github-client";
import { getPackageSourceRepo } from "../api-clients/deps-dev-client";
import { isFreemailDomain, normalizeCompanyName } from "../utils/domain";
import { sql, isNotNull } from "drizzle-orm";
import { todayIso } from "../dates";

type GetRepoFn = (registry: string, pkg: string, version: string | null) => Promise<string | null>;

/** Mirrors company-resolution's org path: website domain first, name second. */
function getOrCreateCompanyForOrg(
  db: ReturnType<typeof getDb>,
  orgLogin: string,
  profile: { name: string | null; blog: string | null }
): number | null {
  if (profile.blog) {
    try {
      const url = profile.blog.startsWith("http") ? profile.blog : `https://${profile.blog}`;
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (domain && !isFreemailDomain(domain)) {
        const existing = db.select().from(companies).where(sql`${companies.domain} = ${domain}`).get();
        if (existing) return existing.id;
        return db
          .insert(companies)
          .values({ name: profile.name || orgLogin, domain, website: `https://${domain}` })
          .returning()
          .get().id;
      }
    } catch {
      // fall through to the name path
    }
  }
  const normalized = normalizeCompanyName(profile.name || orgLogin);
  if (!normalized) return null;
  const existing = db
    .select()
    .from(companies)
    .where(sql`LOWER(${companies.name}) = LOWER(${normalized})`)
    .get();
  if (existing) return existing.id;
  return db.insert(companies).values({ name: normalized }).returning().get().id;
}

/**
 * The depends-on-competitor signal (PRD #17, issue #22): dependents of
 * competitor packages → source repo (deps.dev) → owning org (GitHub) →
 * company, recorded one row per (company, package, dependent). Unresolvable
 * dependents are skipped per-dependent — data quality never fails the step.
 */
export async function resolveCompetitorDependents(
  getRepoFn: GetRepoFn = getPackageSourceRepo,
  client: GithubClient = createGithubClient()
) {
  const db = getDb();
  const today = todayIso();

  const competitorPackages = db
    .select()
    .from(trackedPackages)
    .where(isNotNull(trackedPackages.competitor))
    .all();
  if (competitorPackages.length === 0) {
    console.log("[competitor-deps] No competitor packages tracked");
    return;
  }

  const orgCompanyCache = new Map<string, number | null>();
  let recorded = 0;
  let skipped = 0;

  for (const pkg of competitorPackages) {
    const dependents = db
      .select()
      .from(reverseDependencies)
      .where(sql`${reverseDependencies.packageId} = ${pkg.id}`)
      .all();

    for (const dependent of dependents) {
      try {
        const repo = await getRepoFn(
          dependent.dependentRegistry,
          dependent.dependentName,
          dependent.dependentVersion
        );
        if (!repo) {
          skipped++;
          continue;
        }
        const owner = repo.split("/")[1]; // "github.com/{owner}/{name}"
        if (!owner) {
          skipped++;
          continue;
        }

        let companyId = orgCompanyCache.get(owner);
        if (companyId === undefined) {
          try {
            const profile = await client.getUserProfile(owner);
            companyId = getOrCreateCompanyForOrg(db, owner, profile);
          } catch {
            companyId = null; // org lookup failed — skip, never fail the step
          }
          orgCompanyCache.set(owner, companyId);
        }
        if (companyId == null) {
          skipped++;
          continue;
        }

        db.insert(companyCompetitorSignals)
          .values({
            companyId,
            packageId: pkg.id,
            signalType: "depends_on",
            dependentName: dependent.dependentName,
            firstSeen: today,
          })
          .onConflictDoNothing()
          .run();
        recorded++;
      } catch (err) {
        skipped++;
        console.warn(`[competitor-deps] Skipping ${dependent.dependentName}:`, err);
      }
    }
  }

  console.log(`[competitor-deps] ${recorded} signals recorded, ${skipped} dependents skipped`);
}
```

- [ ] **Step 4:** Green → commit:

```bash
git add src/lib/types/scoring.ts src/lib/collectors/competitor-dependents.ts src/lib/collectors/competitor-dependents.test.ts
git commit -m "feat: resolve competitor-package dependents to companies as depends-on signals"
```

---

### Task 5: Pipeline registration

- [ ] **Step 1: Failing definition test** — update `definition.test.ts`: count 14→15 (text "config-sync + seed-defaults + 13 collectors"), add `"resolve-competitor-dependents"` to the names list, and append:

```ts
  it("scoring waits for the depends-on signal step", () => {
    const scoring = pipelineSteps.find((s) => s.name === "company-scoring")!;
    expect(scoring.dependsOn).toContain("resolve-competitor-dependents");
  });
```

Run → FAIL.

- [ ] **Step 2: Register** — in `definition.ts`: import the step, add before company-scoring:

```ts
  {
    // The depends-on-competitor signal: reads reverse_dependencies persisted
    // by prior deps-dev runs (no hard edge on deps-dev — a flaky deps.dev day
    // must not skip the scoring chain; new dependents lag at most one run).
    name: "resolve-competitor-dependents",
    dependsOn: ["config-sync"],
    run: () => resolveCompetitorDependents(),
  },
```

and company-scoring becomes:

```ts
  {
    name: "company-scoring",
    dependsOn: ["company-resolution", "resolve-competitor-dependents"],
    run: () => scoreCompanies(),
  },
```

- [ ] **Step 3:** Green (incl. runner-validated acyclicity + config-sync reachability) → commit:

```bash
git add src/lib/pipeline/definition.ts src/lib/pipeline/definition.test.ts
git commit -m "feat: register resolve-competitor-dependents before company-scoring"
```

---

### Task 6: Scoring integration

- [ ] **Step 1: Failing test** — in `company-scoring.test.ts`, seed after the events block:

```ts
// Depends-on signals: 2 dependents on one competitor package → 2 × 12 = 24
// added to the competitor aggregate.
run(
  "INSERT INTO tracked_packages (registry, name, competitor) VALUES ('npm', 'pinata-js', 'Acme')"
);
const rivalPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='pinata-js'").get() as { id: number }
).id;
const signal = (dependent: string) =>
  run(
    "INSERT INTO company_competitor_signals (company_id, package_id, signal_type, dependent_name, first_seen) VALUES (?, ?, 'depends_on', ?, '2026-06-01')",
    companyId,
    rivalPkgId,
    dependent
  );
signal("acme-app");
signal("acme-cli");
```

and update the aggregate expectation in the first test: competitor aggregate becomes `10 + 24 = 34`:

```ts
    expect(aggregates).toEqual([
      { scope: "competitor", score: 34 },
      { scope: "own", score: 18 },
    ]);
```

Run → FAIL (still 10).

- [ ] **Step 2: Implement** — in `company-scoring.ts`: import `companyCompetitorSignals` + `DEPENDS_ON_WEIGHT`, and before the aggregate delete-then-insert block:

```ts
    // Depends-on-competitor signals (issue #22): the strongest prospect
    // signal, capped per package like engagement types.
    const signalCounts = db
      .select({
        packageId: companyCompetitorSignals.packageId,
        n: sql<number>`COUNT(*)`,
      })
      .from(companyCompetitorSignals)
      .where(sql`${companyCompetitorSignals.companyId} = ${company.id}`)
      .groupBy(companyCompetitorSignals.packageId)
      .all();
    for (const s of signalCounts) {
      totals.competitor.score += Math.min(s.n, MAX_EVENTS_PER_TYPE) * DEPENDS_ON_WEIGHT;
    }
```

Note: the `userLinks.length === 0 → continue` guard would skip depends-on-only companies (they have no linked users). Move the signal query ABOVE that guard and change it to:

```ts
    if (userLinks.length === 0 && signalCounts.length === 0) continue;
```

(with the signal query placed right after `userLinks`).

- [ ] **Step 3:** Green (both scoring tests; the idempotency test's count stays 2) → commit:

```bash
git add src/lib/collectors/company-scoring.ts src/lib/collectors/company-scoring.test.ts
git commit -m "feat: depends-on signals feed the competitor aggregate at high weight"
```

---

### Task 7: Attribution contract + detail route + page phrasing

- [ ] **Step 1: Failing route test** — in `[id]/route.test.ts`, seed after the repoScore block:

```ts
sqlite
  .prepare(
    "INSERT INTO tracked_packages (registry, name, display_name, competitor) VALUES ('npm', 'pinata-js', 'Pinata JS', 'Pinata')"
  )
  .run();
const rivalPkgId = (
  sqlite.prepare("SELECT id FROM tracked_packages WHERE name='pinata-js'").get() as { id: number }
).id;
sqlite
  .prepare(
    "INSERT INTO company_competitor_signals (company_id, package_id, signal_type, dependent_name, first_seen) VALUES (?, ?, 'depends_on', 'acme-app', '2026-06-01'), (?, ?, 'depends_on', 'acme-cli', '2026-06-01')"
  )
  .run(companyId, rivalPkgId, companyId, rivalPkgId);
```

Update the existing attribution expectation: the engagement row gains `signal: "engagement", dependentCount: 0`, and a second row follows:

```ts
      {
        competitor: "Pinata",
        entity: "pinata-js",
        displayName: "Pinata JS",
        signal: "depends_on",
        dependentCount: 2,
        score: 24,
        userCount: 0,
        starCount: 0,
        forkCount: 0,
        issueCount: 0,
        prCount: 0,
        commitCount: 0,
      },
```

(engagement row first — score 14 vs 24? Order by score desc → depends_on row (24) FIRST, engagement row (14) second; write the expectation in that order.)

Run → FAIL.

- [ ] **Step 2: Contract** — `CompetitorAttributionRow` gains:

```ts
  /** How the signal was observed: repo engagement or package dependency. */
  signal: "engagement" | "depends_on";
  /** Dependent count behind a depends_on row; 0 for engagement rows. */
  dependentCount: number;
```

- [ ] **Step 3: Route** — in `[id]/route.ts`: import `companyCompetitorSignals`, `trackedPackages`, `DEPENDS_ON_WEIGHT`, `MAX_EVENTS_PER_TYPE` (from `@/lib/types/scoring`). Engagement mapping gains `signal: "engagement" as const, dependentCount: 0`. After it:

```ts
  const signalRows = db
    .select({
      name: trackedPackages.name,
      displayName: trackedPackages.displayName,
      competitor: trackedPackages.competitor,
      n: sql<number>`COUNT(*)`,
    })
    .from(companyCompetitorSignals)
    .innerJoin(trackedPackages, sql`${companyCompetitorSignals.packageId} = ${trackedPackages.id}`)
    .where(sql`${companyCompetitorSignals.companyId} = ${companyId}`)
    .groupBy(companyCompetitorSignals.packageId)
    .all();
  const dependsOnAttribution = signalRows
    .filter((r) => r.competitor != null)
    .map((r) => ({
      competitor: r.competitor!,
      entity: r.name,
      displayName: r.displayName,
      signal: "depends_on" as const,
      dependentCount: r.n,
      score: Math.min(r.n, MAX_EVENTS_PER_TYPE) * DEPENDS_ON_WEIGHT,
      userCount: 0,
      starCount: 0,
      forkCount: 0,
      issueCount: 0,
      prCount: 0,
      commitCount: 0,
    }));
  const competitorAttribution = [...engagementAttribution, ...dependsOnAttribution].sort(
    (a, b) => b.score - a.score
  );
```

(rename the existing mapped const to `engagementAttribution`).

- [ ] **Step 4: Transform + page** — `transforms.ts` gains (with tests: 1 → "1 dependent repo", 3 → "3 dependent repos"):

```ts
/** "2 dependent repos" — the depends-on attribution phrasing. */
export function formatDependentCount(n: number): string {
  return `${n} dependent ${n === 1 ? "repo" : "repos"}`;
}
```

Detail page attribution row text becomes signal-aware:

```tsx
                    <span className="text-sm">
                      {row.signal === "depends_on" ? (
                        <>
                          ships code on <span className="font-medium">{row.competitor}</span>:{" "}
                          {formatDependentCount(row.dependentCount)} use{" "}
                          <span className="font-medium">{row.displayName || row.entity}</span>
                        </>
                      ) : (
                        <>
                          engages with <span className="font-medium">{row.competitor}</span>:{" "}
                          {formatEngagementBreakdown(row)} on{" "}
                          <span className="font-medium">{row.displayName || row.entity}</span>
                        </>
                      )}
                    </span>
```

and the subtitle's user count renders only for engagement rows:

```tsx
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {row.entity}
                      {row.signal === "engagement" &&
                        ` · ${row.userCount} ${row.userCount === 1 ? "user" : "users"}`}
                    </div>
```

- [ ] **Step 5:** All green (route + transforms + lint + build) → commit:

```bash
git add src/lib/types/sales-intelligence.ts "src/app/api/companies/[id]/" src/app/companies/transforms.ts src/app/companies/transforms.test.ts "src/app/companies/[id]/page.tsx"
git commit -m "feat: depends-on signals in company detail attribution"
```

---

### Task 8: Docs + verification + demo + PR/merge

- [ ] **Step 1: CLAUDE.md** — pipeline sentence: 14 steps → 15, adding `resolve-competitor-dependents` to the linear-chain description; scoring paragraph notes the signals table. Commit.

- [ ] **Step 2:** `npm test && npm run lint && npm run build` — all green.

- [ ] **Step 3: Demo on a DB copy** — seed competitor npm package + reverse_dependencies rows; scratch script runs `resolveCompetitorDependents(fakeGetRepo, fakeGithub)` (fakes inline in the scratch — the live APIs aren't exercised) then `scoreCompanies()`; dev server on the copy → `/api/companies` shows the dependent's org company as a prospect; `/api/companies/<id>` shows the depends_on attribution row; headless click-through asserts the detail page renders "ships code on … dependent repos use …". Teardown to a clean tree.

- [ ] **Step 4: PR + merge** (standing authorization): per-AC table (5 ACs), notes (package→repo resolution via deps.dev GetVersion; no hard deps-dev edge — rationale; weight 12 calibration; signal caps). Merge, confirm #22 closed.

---

## Self-Review

1. **AC coverage:** new step registered w/ correct deps + isolation → Task 5 (definition test asserts the scoring edge; runner semantics untouched); org resolution + skip-don't-fail → Task 4 (test: null-repo and 404-org dependents skipped, step succeeds); high-weight score + segment updates → Task 6 (aggregate math 10+24, segments derive from the aggregate, no-user companies now scored); detail attribution → Task 7 (exact payload + phrasing); DB-backed step test w/ injected clients → Task 4 prior-art style.
2. **Placeholder scan:** none — full code everywhere; Task 8 demo references the same scratch-script pattern executed in #19/#21 with concrete assertions.
3. **Type consistency:** `signal`/`dependentCount` added to one interface used by route map + test + page; `GetRepoFn` matches `getPackageSourceRepo` signature; step name string identical in definition, its test, and CLAUDE.md.
