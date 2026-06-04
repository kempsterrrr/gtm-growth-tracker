# Per-Entity Engagement + Companies Filtering/Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signal provenance per person and entity-level slicing per company (GitHub issue #44, parent PRD #42): per-entity engagement lines replace generic badges, the Companies list gains an entity filter, and every column sorts.

**Architecture:** New contract shape `EntityEngagement { entity; displayName; competitor; starCount; forkCount; issueCount; prCount; commitCount; lastAt }`; `CompanyUser` drops the unscoped `engagementTypes`/`eventCount` (genuinely misleading — they summed across ALL repos including competitors') in favor of `engagements: EntityEngagement[]` built in the detail route by grouping each primary user's events per repo (joined for label + competitor attribution; counts raw, `lastAt` = max anchor date). `CompanySummary` gains `activeEntities: string[]` — distinct entity labels from the company's per-repo score rows plus depends-on signal packages (ever-active; composes with the existing activity windows for recency). Companies page: an entity `<select>` (options = union of labels in the loaded list) filtering via a tested `filterByEntity` transform; `SortKey` grows to `name | users | trend` with clickable headers (text via localeCompare, numbers numeric, existing nulls-last date handling untouched). The user-row UI renders one line per engagement (breakdown phrasing + competitor marker + relative age); `EngagementBadges` is deleted if unused after the swap.

**No schema change this slice** — read-time derivation only.

---

## Tasks

### Task 1: Branch + plan
```bash
git checkout -b feat/per-entity-engagement && git add docs/superpowers/plans/2026-06-04-per-entity-engagement.md && git commit -m "docs: implementation plan for per-entity engagement + companies filtering (#44)"
```

### Task 2: Detail route engagements (TDD)
Route test (red): the insider user (star on own repo? seed events for the primary 'insider' user across the own repo AND the pinata competitor repo) → `users[].engagements` equals exactly `[{entity:"pinata/pinata-sdk", displayName:"Pinata SDK", competitor:"Pinata", ...counts, lastAt}, ...]` ordered by lastAt desc; `engagementTypes`/`eventCount` gone from the payload (exact-keys check). Implement: contract change + per-user grouped query (events join tracked_repos; group in JS per repo: counts per type, max anchor). Green → commit.

### Task 3: Companies activeEntities (TDD)
List route test (red): battleground-co gains a per-repo competitor score row (joined repo) and a depends-on signal (joined package) → `activeEntities: ["pinata/pinata-sdk", "pinata-js"]`; engaged-co (aggregates only) → `[]`; exact contract keys updated. Implement: per-company distinct-label queries (per-repo rows join repos; signals join packages). Green → commit.

### Task 4: Transforms + page (TDD on transforms)
`filterByEntity(companies, label | null)` (null = all; match on activeEntities membership); `sortCompanies` gains `name` (localeCompare, case-insensitive) / `users` / `trend`. Page: entity select beside the activity tabs (options from loaded data), clickable Company/Users/Trend headers, user rows render engagement lines (`formatEngagementBreakdown(e)` + `(competitor)` marker + `formatRelativeAge(e.lastAt)`), affiliations untouched; delete `EngagementBadges` if now unused. Lint/build → commit.

### Task 5: Verify + demo + PR/merge
Full suite. Live: headless — filter Companies by an Irys entity → list narrows; sort by Company name; open a company → user rows show per-entity lines with competitor markers. PR per-AC table; merge on green; confirm #44 closed.
