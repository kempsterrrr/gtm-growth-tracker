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

1. **Collection pipeline** (`src/scripts/collect-all.ts`, run via `npm run collect` or the daily GitHub Action): a thin adapter over `src/lib/pipeline/` — `definition.ts` is the **single registry** of all 13 steps (`config-sync`, the five independent metric collectors `github`/`npm`/`pypi`/`deps-dev`/`events-auto`, and the linear sales-intelligence chain `github-engagement` → `github-user-enrichment` → `github-commit-emails` → `company-resolution` → `company-scoring` → `alerts-evaluator` → `slack-notifier`), and `runner.ts` (`runPipeline`) owns dependency ordering, per-step failure isolation (a failed step marks its transitive dependents `skipped`; independent steps still run), and persists a run record to `pipeline_runs`/`pipeline_run_steps`. The CLI exits non-zero if any step failed; the manual trigger (`src/app/api/collect/route.ts`) runs the identical definition. Adding a collector = one entry in `definition.ts`. Each step lives in `src/lib/collectors/` and uses an API client from `src/lib/api-clients/`.
2. **Dashboard** (`src/app/`): pages are client components that fetch from the API routes in `src/app/api/`, which are thin read-only queries over the same SQLite tables. Charts use Recharts via wrappers in `src/components/charts/`.

### Schema is defined in TWO places — keep them in sync

- `src/lib/db/schema.ts` — Drizzle table definitions used by all queries.
- `src/lib/db/migrate.ts` — hand-written, idempotent raw SQL (`CREATE TABLE IF NOT EXISTS`) that is the **actual** migration mechanism, run by `npm run db:migrate` and at the start of every collect run.

`drizzle.config.ts` exists but drizzle-kit generated migrations are not used. When adding a table or column, update both files.

### Configuration flow

`gtm-config.yaml` is the source of truth for which repos/packages are tracked. `src/scripts/sync-config.ts` upserts it into `tracked_repos`/`tracked_packages` on every collect run. The Settings page edits the YAML through `src/app/api/config/route.ts`, so config changes can come from either the file or the UI. Package names are validated with `src/lib/validation/package-name.ts`.

### Deployment & data lifecycle

- The SQLite DB (`data/gtm-tracker.db`) is **committed to git**: the daily workflow (`.github/workflows/collect-daily.yml`) runs the collector at 6 AM UTC and pushes the updated DB. Expect upstream commits touching `data/`.
- GitHub traffic data expires after 14 days on GitHub's side — gaps in collection lose it permanently.
- Railway deployment via `Dockerfile` + `railway.toml`; `.github/workflows/deploy-railway.yml` deploys on merge to main.

### Conventions

- Dates are stored as ISO `YYYY-MM-DD` text; daily metric tables have a unique `(entityId, date)` index and collectors upsert on it.
- Path alias `@/` → `src/`.
- ar.io branding: Besley headlines, Plus Jakarta Sans body, primary purple `#5427C8` (see `globals.css` / Tailwind v4 config-in-CSS).
