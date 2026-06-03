# Decay-Weighted Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recency as a first-class property of scoring (GitHub issue #35, parent PRD #34): every engagement event's weight decays exponentially with age; fully-cooled aggregates drop below a floor and vanish from segments; depends-on stays full-weight.

**Architecture:** A pure decay module (`src/lib/decay.ts`: three default constants + `decayMultiplier(ageDays)` returning `0.5^(age/halfLife)` and `0` past max age + `eventAgeDays(eventDate, collectedAt, today)` with the collected-at fallback) consumed by the scoring step. The step's per-user query changes from `GROUP BY event_type, COUNT(*)` to fetching individual events (type, event_date, collected_at) — grouped in JS per type keeping the **5 most recent**, each decayed individually. The aggregate write condition changes from `score > 0` to `score ≥ MIN_AGGREGATE_SCORE` (1.0). Depends-on signal scoring is untouched. **Backward-compatible by construction:** the existing scoring tests seed events without dates → collected-at fallback → age 0 → multiplier 1.0 → every existing expectation (18/10/34, employee exclusion, idempotency) passes unchanged — proving undated/today data behaves exactly as before.

**Key facts pinned:**
- Knobs are code constants in this slice (defaults 90 / 360 / 1.0); #37 makes them config-driven — the scoring step should take them as parameters with constant defaults NOW so #37 only threads values.
- Deterministic decay tests: seed `event_date = daysAgoIso(90)` → exactly one half-life → exactly 0.5×; `daysAgoIso(180)` → 0.25×; `daysAgoIso(400)` → skipped. `todayIso()`-anchored ages are integral days; no clock injection.
- Caps: per type, sort events newest-first, take 5, decay each — preserves the old cap's intent under decay (the 5 best-possible-value events).
- Floor: applies to the aggregate write only (per-repo rows keep the legitimate small scores so attribution still explains them; an aggregate under 1.0 = "no signal" for segments/lists/alerts). Hmm — per-repo rows with `repoUsers > 0` continue writing as today.
- Counts (`star_count` etc.) remain RAW capped counts (facts), not decayed.
- No alert/UI/contract changes in this slice.

---

## Tasks

### Task 1: Branch + plan
```bash
git checkout -b feat/decay-scoring && git add docs/superpowers/plans/2026-06-04-decay-scoring-engine.md && git commit -m "docs: implementation plan for decay-weighted scoring (#35)"
```

### Task 2: Pure decay module (TDD)
`src/lib/decay.test.ts` (red): multiplier at 0d→1, 90d→0.5, 180d→0.25, 270d→0.125; ≥360d→0; negative age clamps to 1; `eventAgeDays` uses eventDate when present, collectedAt otherwise, never negative. Implement `src/lib/decay.ts`:
- `export const DECAY_HALF_LIFE_DAYS = 90`, `DECAY_MAX_AGE_DAYS = 360`, `MIN_AGGREGATE_SCORE = 1.0`
- `decayMultiplier(ageDays, halfLife = DECAY_HALF_LIFE_DAYS, maxAge = DECAY_MAX_AGE_DAYS): number`
- `eventAgeDays(eventDate: string | null, collectedAt: string, todayIsoDate: string): number` (date-only math via the dates module)
Green → commit.

### Task 3: Scoring integration (TDD)
Extend `company-scoring.test.ts` FIRST (red):
- new describe seeding a second company with dated events: competitor issue at `daysAgoIso(90)` → contributes exactly 4 (8×0.5) + breadth 2 → aggregate 6; same company own star at `daysAgoIso(180)` → 0.25 own + breadth... own aggregate = 0.25+2 = 2.25;
- an event at `daysAgoIso(400)` contributes nothing (company with ONLY that → no competitor aggregate row at all — floor + skip);
- floor case: single competitor star at `daysAgoIso(270)` → 0.125 + 2 = 2.125 ≥ 1 → row exists; engineer a sub-1.0 case: star at 270d with… breadth makes sub-1 hard; instead assert the >360d-only company case (no row) AND a constructed `0.5 + 0` …simplest deterministic sub-floor: a single fork (weight 3) at 350d → 3×0.5^(350/90)=0.2 + breadth 2 = 2.2 — breadth keeps everything ≥2. **Floor only bites when breadth is 0 — impossible while breadth counts undecayed users.** Decision (consistent with "score-carrying users count toward breadth"): a user whose decayed score rounds to 0 (all events skipped) isn't score-carrying → no breadth; partial decay keeps breadth. So sub-floor aggregates occur only via the all-events-skipped path → equivalent to the no-row case. The floor check `>= MIN_AGGREGATE_SCORE` still replaces `> 0` (it's the #37 knob), with the >360d test as its observable proof.
- depends-on: signal with `first_seen` 2 years old still contributes 12 → assert.
- existing tests untouched and green (undated events = full weight).
Implement: per-user events query returns rows `(event_type, event_date, collected_at)` ordered `event_date DESC NULLS LAST`… SQLite: `ORDER BY event_date IS NULL, event_date DESC`. JS-group per type, slice(0,5), sum `weight × decayMultiplier(eventAgeDays(...))`; counts increment per kept event (raw). Aggregate write gate: `t.score >= MIN_AGGREGATE_SCORE`. `scoreCompanies(knobs = {halfLife, maxAge, floor} defaults)` parameterized for #37.
Green → commit.

### Task 4: Verify + live demo + PR + merge
`npm test`, lint, build. Live demo on the real DB (this is the correction we WANT): capture `/api/companies` before; run scoring via scratch script; after — show the re-rank: stale-only companies gone from prospect/battleground tabs, fresh ones promoted; counts of segment flips; confirm battleground_shift fired nothing (transitions out are silent). PR with per-AC table; merge on green (standing authorization); confirm #35 closed.
