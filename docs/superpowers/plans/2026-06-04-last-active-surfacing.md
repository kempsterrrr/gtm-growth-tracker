# Last-Active Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-side last-engagement timestamps end-to-end (GitHub issue #36, parent PRD #34): scoring stamps them, the companies payloads carry them, the list sorts/filters by them, the detail shows both sides.

**Architecture:** One additive nullable column `last_event_date` on `company_scores` (migration 0006), stamped by the scoring step as the max event date among the events it actually kept (per repo row, and per-scope aggregate = max across that scope's repos; dateless events contribute their collection date). Contract: `CompanySummary` gains `lastOwnEngagementAt: string | null` + `lastCompetitorEngagementAt: string | null` (detail inherits). Companies list route reads them off the per-scope aggregate rows it already fetches. UI: one sortable "Last Active" column (fresher of the two, relative phrasing via a tested `formatRelativeAge` transform), an All/90d/30d activity filter (tested `filterByActivity` transform) beside the segment tabs, detail header line with both sides, "—" when null (deps-only prospects).

**Key facts pinned:**
- Stamping uses the SAME kept-events walk as decay (>max-age events are skipped, so a company whose only events are ancient gets no aggregate row at all — consistent).
- `SortKey` grows to include `"lastActive"`; sorting nulls last in both directions.
- Depends-on signals do NOT stamp engagement timestamps (the dependency is the liveness signal — PRD).
- Relative phrasing: "today", "2d ago", "3mo ago" — pure transform, tested at boundaries.
- Alerts/compare untouched.

---

## Tasks

### Task 1: Branch + plan
```bash
git checkout -b feat/last-active && git add docs/superpowers/plans/2026-06-04-last-active-surfacing.md && git commit -m "docs: implementation plan for last-active surfacing (#36)"
```

### Task 2: Column + stamping (TDD)
Migrate-gate assertion for `company_scores.last_event_date` (nullable) → red → schema + `npx drizzle-kit generate --name last-event-date` → green. Scoring test (red): Recencio's competitor aggregate row carries `last_event_date = daysAgoIso(90)` (its only kept competitor event) and own aggregate `daysAgoIso(180)`; Globex (undated events) carries today's date on both. Implement: track `lastEvent` per repo loop (max kept event anchor date) + per-scope totals; write into per-repo rows and aggregates. Green → commit.

### Task 3: Contract + routes (TDD)
Route tests (red): companies list payload rows carry both fields (exact contract keys updated); detail carries both. Implement: contract fields, list route maps `own?.lastEventDate`/`competitor?.lastEventDate`, detail same. Green → commit.

### Task 4: Transforms + UI
Transforms (TDD): `filterByActivity(companies, "all" | "90d" | "30d", todayIso)` using the fresher timestamp; `latestActivity(company): string | null`; `formatRelativeAge(iso, todayIso)` ("today", "5d ago", "2mo ago", "1y ago"); `sortCompanies` gains `lastActive` key with nulls-last. Pages: list column (sortable header like the score columns) + activity filter buttons beside segment tabs; detail header "Last engaged us … · Last on competitor …" with — for nulls. Lint/build → commit.

### Task 5: Verify + demo + PR/merge
Full suite; live demo: list sorted by Last Active and filtered to 30d via headless click-through; detail shows both sides. PR per-AC table; merge on green; confirm #36 closed.
