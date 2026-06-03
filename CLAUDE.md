# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run db:migrate   # Create/update SQLite schema (idempotent)
npm run collect      # Run the full data-collection pipeline
npm run db:seed      # Backfill npm download history
npm test             # Vitest (pipeline tests; no live tokens needed)
```

Tests use Vitest against a temp SQLite file via `DATABASE_PATH` (real SQLite, no mocks; set the env var *before* importing db modules — they read it at import time). Requires `GITHUB_TOKEN` in `.env.local` (a fine-grained PAT; Administration:Read is needed for traffic data, everything else works without it). Optional: `DATABASE_PATH` (defaults to `data/gtm-tracker.db`), `SLACK_WEBHOOK_URL`.

## Architecture

Next.js 16 App Router dashboard + a standalone collection pipeline, both reading/writing one local SQLite database via Drizzle ORM (better-sqlite3, **synchronous** API — `.get()`/`.all()`/`.run()`, no `await` on queries).

### Two halves, one database

1. **Collection pipeline** (`src/scripts/collect-all.ts`, run via `npm run collect` or the daily GitHub Action): a thin adapter over `src/lib/pipeline/` — `definition.ts` is the **single registry** of all 15 steps (`config-sync`, `seed-defaults`, the five independent metric collectors `github`/`npm`/`pypi`/`deps-dev`/`events-auto`, the linear sales-intelligence chain `github-engagement` → `github-user-enrichment` → `github-commit-emails` → `company-resolution` → `company-scoring` → `alerts-evaluator` → `slack-notifier`, and `resolve-competitor-dependents` feeding `company-scoring` — it reads reverse_dependencies persisted by prior `deps-dev` runs, deliberately without a hard edge on `deps-dev` so a flaky deps.dev day never skips the scoring chain), and `runner.ts` (`runPipeline`) owns dependency ordering, per-step failure isolation (a failed step marks its transitive dependents `skipped`; independent steps still run), and persists a run record to `pipeline_runs`/`pipeline_run_steps`. The CLI exits non-zero if any step failed; the manual trigger (`src/app/api/collect/route.ts`) runs the identical definition. Adding a collector = one entry in `definition.ts`. Each step lives in `src/lib/collectors/`. ALL GitHub HTTP access goes through the single deep client `src/lib/api-clients/github-client.ts` (`createGithubClient` — owns auth, the one rate-limit wait policy, pagination iterators, typed `GithubApiError`/`GithubAuthError`); collectors accept an injected `GithubClient` for offline testing. Other registries use the simple clients in `src/lib/api-clients/`.
2. **Dashboard** (`src/app/`): the four metric pages (github/npm/pypi/dependencies) are declarations over the metric-page shell — `src/components/metric-page/use-metric-page.ts` (one data flow: list → auto-select → keyed detail fetch → derived `loading|error|empty|ready` status, explicit error state with retry, no silent catches; configs must be module-level constants) and `MetricPageShell.tsx` (chrome + state UI + declarative card grid). A new metric page = a module-level `MetricPageConfig`, a cards array, and chart children. Page-specific math lives in exported, unit-tested transforms (e.g. `src/app/npm/aggregate.ts`). The competitor compare toggle follows the same split: pure overlay math in `src/components/metric-page/compare.ts` (tested), fetch flow in `use-competitor-compare.ts` (module-level config, keyed state, explicit error), competitor entities via the list endpoints' `?competitors=1` view + the unguarded detail-by-id series paths. API routes are thin read-only queries over the same SQLite tables; charts use Recharts via wrappers in `src/components/charts/`.

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
competitor engagement. The Companies UI derives its filter/sort/phrasing in
`src/app/companies/transforms.ts` (exported, unit-tested); the detail API's
`competitorAttribution` exposes the latest per-repo competitor score rows
plus depends-on rows from `company_competitor_signals` (one row per
company × competitor package × dependent; written by
`resolve-competitor-dependents`, scored at `DEPENDS_ON_WEIGHT`, capped per
package like engagement types). Competitor employees are tagged on
`github_users` (`competitor_employee` + source: commit_activity /
org_membership / domain_match) by `tagCompetitorEmployees`, which runs at
the END of company-resolution (not a pipeline step); tagging is additive
(set once, never overwritten/deleted). Tagged users are excluded from
competitor-scope aggregation only (own-side engagement stays visible,
badged in the UI), and the competitor's own company (tracked name or
configured domain match) never gets a competitor aggregate — it can't rank
as its own prospect. Alerts: seven rule types — the original four plus
`new_prospect` (competitor-only aggregate over threshold),
`battleground_shift` (segment transitions to battleground from either
side, prior state required), and `competitor_employee_engagement` (tagged
users on own repos, `collected_at`-windowed so backfills never fire); all
seeded by seed-defaults, 7-day debounce per company (per user for the
employee rule).

### Deployment & data lifecycle

- The SQLite DB (`data/gtm-tracker.db`) is **committed to git**: the daily workflow (`.github/workflows/collect-daily.yml`) runs the collector at 6 AM UTC and pushes the updated DB. Expect upstream commits touching `data/`.
- GitHub traffic data expires after 14 days on GitHub's side — gaps in collection lose it permanently.
- Railway deployment via `Dockerfile` + `railway.toml`; `.github/workflows/deploy-railway.yml` deploys on merge to main.

### Conventions

- Dates are stored as ISO `YYYY-MM-DD` text; ALL date formatting/windows/growth go through `src/lib/dates.ts` (`toIsoDate`/`todayIso`/`daysAgoIso`/`growthPercent` — never inline `.toISOString().split`). Daily metric tables have a unique `(entityId, date)` index and collectors upsert on it.
- API contract: `src/lib/types/api.ts` declares every dashboard route's GET payload; routes annotate their payload consts with it and pages import the same types — never declare a response shape locally. The contract describes the wire exactly (e.g. SQLite 0/1 integers, not booleans).
- Path alias `@/` → `src/`.
- ar.io branding: Besley headlines, Plus Jakarta Sans body, primary purple `#5427C8` (see `globals.css` / Tailwind v4 config-in-CSS).
