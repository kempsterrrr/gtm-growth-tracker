# Primary-Company Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One human, one employer, counted once (GitHub issue #43, parent PRD #42): a primary flag on user-company links picked by confidence, scoring counts primary-only, company detail splits primary users from affiliations.

**Architecture:** Additive `is_primary` integer flag (default 0) on `github_user_companies` (migration 0007). `resolveCompanies()` ends by recomputing primaries set-wise (SQLite window function: per user, `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY confidence DESC, id ASC)` → rn 1 wins — confidence picks, first-discovered breaks ties; links never deleted; re-runs idempotent and upgrade the primary when stronger evidence lands, because email upserts use `MAX(confidence)`). Scoring's per-company user set gains `is_primary = 1`. Detail payload: `users` = primary links only (their existing `source` field IS the deciding signal); new `affiliated: AffiliatedUser[]` (id, login, name, avatarUrl, source) on the contract; UI renders a collapsed muted "Also affiliated (N)" block.

**Key facts pinned:**
- Resolution currently has NO test file — this slice creates `company-resolution.test.ts` (offline: resolution reads only DB tables; tagging inside it degrades gracefully without config).
- Scoring change is one predicate; existing tests keep passing (each test company's users are single-linked... except the employee/competitor-company describes added links to shared companies — verify; the recompute runs in RESOLUTION, so scoring tests that seed links directly get `is_primary = 0` defaults → scoring would count NOBODY. Scoring tests must seed `is_primary = 1` on their links (single-linked users = their primary by definition). Update the test helpers' INSERTs — semantically correct, not expectation-fudging.
- Live demo: re-resolve + rescore the real DB → multi-linked users collapse to one primary each; report the aggregate-count shift.

---

## Tasks

### Task 1: Branch + plan
```bash
git checkout -b feat/primary-company && git add docs/superpowers/plans/2026-06-04-primary-company-dedup.md && git commit -m "docs: implementation plan for primary-company dedup (#43)"
```

### Task 2: Flag migration (TDD via migrate gate)
Gate assertion: `github_user_companies.is_primary` notnull 1 dflt 0 → red → schema (`isPrimary: integer("is_primary").notNull().default(0)`) + `npx drizzle-kit generate --name primary-company-flag` → green → commit.

### Task 3: Resolution recompute (TDD, new test file)
`company-resolution.test.ts` (fresh temp DB): seed user emails/orgs tables so resolveCompanies creates links itself — u1 with `github_user_emails` row (acme.dev) AND two `github_user_orgs` rows → after run: exactly one primary (the email company); org links exist with is_primary 0. Tie case: u2 with two org links only → first-created company link wins. Upgrade case: run once with orgs only (primary = first org), then add an email row, re-run → primary moves to the email company; old links intact. Implement `recomputePrimaryCompanies(db)` (module-private, window-function UPDATE pair) called at the end of `resolveCompanies()` before tagging. Green → commit.

### Task 4: Scoring counts primary only (TDD)
Scoring test: new describe — `shared-dev` linked primary→CompanyA (is_primary 1) + secondary→CompanyB (0), engagement on own repo → A aggregates it, B writes nothing. Update existing seed helpers to set is_primary 1 (single-linked users). Implement: `userLinks` where-clause gains `AND is_primary = 1`. Full scoring suite green → commit.

### Task 5: Detail split (TDD) + UI
Contract: `AffiliatedUser { id; login; name: string|null; avatarUrl: string|null; source: CompanySource }`; `CompanyDetail.affiliated: AffiliatedUser[]`. Route test: company with one primary + one affiliated link → `users` has the primary only; `affiliated` carries the other with its source. Route: split `userLinks` by flag; affiliated skips the per-user event queries. UI: "Also affiliated (N)" muted block under the users table (login + source badge, no event data). Lint/build → commit.

### Task 6: Verify + live demo + PR/merge
Full suite. Live: migrate, run resolution + scoring via scratch → report primaries chosen (83 multi-linked users each get exactly 1), companies-with-aggregates shift, Developerayo's single placement; headless: company detail shows the affiliations block. PR per-AC table; merge on green; confirm #43 closed.
