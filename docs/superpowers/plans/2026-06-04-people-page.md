# People Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every engaged human once (GitHub issue #45, parent PRD #42): a People page with primary company + deciding signal, per-entity lines, employee badge, entity filter, activity windows, sortable columns, freshest first.

**Architecture:** The detail route's per-user entity grouping extracts into a shared server helper (`src/lib/user-engagements.ts`: `entityEngagementsFor(db, userId): EntityEngagement[]` — query + group + sort, the detail route refactors onto it). New contract `PersonSummary { id; login; name; avatarUrl; primaryCompany: { id; name; source: CompanySource } | null; competitorEmployee; competitorEmployeeSource; engagements: EntityEngagement[]; lastActive: string | null }` (lastActive = max engagement lastAt). New thin route `/api/people`: users having ≥1 engagement event, each with primary link join + the shared helper. New page `/people` (+ sidebar entry): table of person / primary company (source badge) / per-entity lines (matching-entity line bolded under the filter) / last active; controls = entity select (union of loaded engagements) + Any time/90d/30d tabs; default freshest-first; people transforms (`src/app/people/transforms.ts` + tests: `filterPeopleByEntity`, `filterPeopleByActivity`, `sortPeopleByLastActive`) reuse `formatRelativeAge`/breakdown from the companies transforms.

**No schema change.**

---

## Tasks

### Task 1: Branch + plan
```bash
git checkout -b feat/people-page && git add docs/superpowers/plans/2026-06-04-people-page.md && git commit -m "docs: implementation plan for the People page (#45)"
```

### Task 2: Shared helper refactor (green-stay-green)
Extract `entityEngagementsFor` from the detail route (no behavior change — detail route suite stays green). Commit.

### Task 3: People route (TDD)
New `route.test.ts` (fresh temp DB): seed two users — one with a primary link + events on own and competitor repos, one tagged employee with competitor-repo events and NO company links; a third user with no events (must not appear). Assert: one row each for the two engaged users; primaryCompany {id,name,source} vs null; engagements arrays exact; lastActive = newest lastAt; employee fields carried; exact contract keys. Implement contract + route. Green → commit.

### Task 4: Transforms + page + sidebar (TDD on transforms)
People transforms tests: entity filter (touched-entity membership via engagements), activity windows on lastActive, freshest-first sort with nulls last. Page: table + controls per the design preview; sidebar entry (match existing nav item pattern); matching entity line bolded when filtered. Lint/build → commit.

### Task 5: Verify + demo + PR/merge
Full suite. Headless: open People (rows render with primary companies + per-entity lines), filter to an Irys entity (narrows, line bolded), Active 30d narrows further, employee badge visible on a tagged Irys person. PR per-AC table; merge on green; confirm #45 closed → **PRD #42 complete**.
