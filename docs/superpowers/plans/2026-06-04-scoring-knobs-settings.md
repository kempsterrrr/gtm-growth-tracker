# Scoring Knobs in Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator control over decay (GitHub issue #37, parent PRD #34): a `scoring:` block in the YAML config with cross-field validation, edited from a Settings Scoring card, consumed by the scoring step on the next run.

**Architecture:** Config module gains `scoringConfigSchema` (`half_life_days` int ≥ 7 default 90; `max_age_days` int default 360; `min_aggregate_score` 0–5 default 1.0; refinement `max_age_days ≥ 2 × half_life_days`) as an optional `scoring:` key on `gtmConfigSchema`, plus `updateScoring()` (validate → read → mutate → YAML-first write; no DB projection — scoring reads the file). A pure `resolveScoringKnobs(config?)` maps the block (or absence) onto `ScoringKnobs` with code defaults; `scoreCompanies` resolves it when no knobs are passed (graceful no-file/malformed fallback like the domain loader). `/api/config` GET exposes the resolved knobs (camelCase, `ScoringSettings` on the contract); POST gains a `type: "scoring"` branch returning 400 with the zod message on cross-field violations. Settings gains a Scoring card: three number inputs, Save, inline error, "applies on the next collection run — use Run Collection Now to apply immediately".

**Key facts pinned:**
- Defaults-when-absent must be byte-identical to #35 behavior (AC) — `resolveScoringKnobs(undefined)` returns the decay module constants.
- Scoring-step threading is tested at the pure seam (`resolveScoringKnobs`) + the existing `ScoringKnobs` param tests; no cwd gymnastics in the step test.
- The config route test already owns the temp-cwd pattern — scoring POST/GET cases slot in.

---

## Tasks

### Task 1: Branch + plan
```bash
git checkout -b feat/scoring-knobs && git add docs/superpowers/plans/2026-06-04-scoring-knobs-settings.md && git commit -m "docs: implementation plan for configurable scoring knobs (#37)"
```

### Task 2: Config module (TDD)
Tests (red): scoring block round-trips through readConfig/updateScoring; partial block fills field defaults; absent block → `readConfig(...).scoring` undefined; rejections: half_life 5 (< 7), floor 9 (> 5), max_age 100 with half_life 90 (cross-field) — each names the offense; `resolveScoringKnobs`: undefined → {90,360,1}, configured block → its values. Implement schema + `updateScoring` + `resolveScoringKnobs` (exported from the config module, consuming the parsed type). Green → commit.

### Task 3: Scoring threading (TDD)
Scoring step: `scoreCompanies(knobs?)` — when a field is unset, resolve from `loadScoringConfig()` (graceful read, mirrors `loadCompetitorDomains`) → `resolveScoringKnobs`. Test: temp-cwd already impossible here — instead assert via knobs param equivalence (existing) PLUS a config-module test proving resolveScoringKnobs output feeds the same shape. Pipeline definition untouched. Green → commit.

### Task 4: Contract + config route (TDD)
`ScoringSettings { halfLifeDays; maxAgeDays; minAggregateScore }` on the contract; `ConfigResponse` gains `scoring: ScoringSettings`. Route tests (red, temp-cwd file): GET returns defaults with no block; POST `{type:"scoring", data:{halfLifeDays:30, maxAgeDays:120, minAggregateScore:0.5}}` → 200, YAML contains the block, GET reflects it; POST cross-field violation → 400 naming it. Implement GET (readConfig graceful) + POST branch. Green → commit.

### Task 5: Settings Scoring card
Three number inputs (step/min hints), Save → POST, inline error from 400s, helper text re next-run + Run Collection Now. Lint/build → commit.

### Task 6: Verify + demo + PR/merge
Full suite. Live demo: GET shows 90/360/1; headless: open Settings, set half-life 30 / max-age 120, Save → YAML diff shows the block; rescore → a 90-day-old-engagement company's score drops (0.5 → 0.125 multiplier class); restore defaults via the card; `git checkout -- gtm-config.yaml` if needed. PR per-AC table; merge on green; confirm #37 closed → PRD #34 series complete.
