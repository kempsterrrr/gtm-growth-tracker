# Competitor Alert Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slack alerting on the three competitor-driven moments (GitHub issue #24, parent PRD #17, final slice): new-prospect threshold crossing, battleground shifts in both directions, and tagged competitor employees engaging our repos — three new rule types in the existing rules engine, seeded, debounced, delivered by the untouched Slack notifier.

**Architecture:** `alert_rules.rule_type` enum gains `new_prospect | battleground_shift | competitor_employee_engagement` — a CHECK change, so drizzle generates a **table-recreate** migration (`0005`; data-preserving `__new_` copy — review carefully, gates verify). Seed-defaults adds rules 3–5 (fixed ids, `onConflictDoNothing`). The evaluator gains three branches reading the scope-aware aggregates (#19), tags (#23), and signals (#22): **new_prospect** = today's competitor aggregate ≥ `min_score` with NO own aggregate today (company debounce); **battleground_shift** = both aggregates today AND the most recent prior day's derived segment ≠ battleground (covers engaged→ and prospect→; brand-new both-sided companies don't fire — no prior state, new-prospect/score-threshold cover day one); **competitor_employee_engagement** = tagged users with events on OWN repos `collected_at` within `window_days` (7, matching debounce; per-user debounce mirroring `new_enterprise_user`). Alert detail carries company, competitor name (top contributor from per-repo rows + signals), and trigger specifics. Slack notifier: generic title+detail — zero changes. Alerts page: `RULE_TYPE_LABELS` is `Record<AlertRuleType, string>`, so the union change forces three label additions (dropdown auto-includes).

**Key facts pinned:**
- Recreate migration must be the standard drizzle `__new_alert_rules` copy (PRAGMA foreign_keys handling included); live-data gate proves row preservation on the production-shaped DB; upgrade-path gate proves CHECK convergence.
- Debounce: existing 7-day per rule+company (the two company rules); per rule+user for employee engagement (prior art: `new_enterprise_user`, but 7 days not 30 — issue: "respect the existing debounce window").
- Detection window for employee events uses `collected_at` (not `event_date` — backfilled historic events must not fire) with `window_days` default 7: a new event fires once; debounce silences re-runs; after 7 days it ages out of the window.
- `AlertRuleConfig` already carries `min_score?`/`window_days?` — no contract change beyond the `AlertRuleType` union.
- Demo = the issue's: seeded competitor-only company over threshold → "New prospect" alert via the real evaluator on a DB copy; re-run within debounce stays silent; alert visible via the alerts API (Slack delivery not exercised — no webhook in the demo env; notifier untouched and generic).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-competitor-alerts.md` | Create | This plan |
| `src/lib/types/sales-intelligence.ts` | Modify | `AlertRuleType` union |
| `src/lib/db/schema.ts` + `drizzle/0005_*` + `migrate.test.ts` | Modify | rule_type CHECK |
| `src/lib/db/seed-defaults.ts` + `src/lib/db/seed-defaults.test.ts` | Modify/Create | Rules 3–5, idempotent |
| `src/lib/collectors/alerts-evaluator.ts` + `.test.ts` | Modify | Three rule branches |
| `src/app/alerts/page.tsx` | Modify | Three labels |
| `CLAUDE.md` | Modify | Conventions |

---

### Task 1: Branch + plan

```bash
git checkout -b feat/competitor-alerts
git add docs/superpowers/plans/2026-06-03-competitor-alerts.md
git commit -m "docs: implementation plan for competitor alert rules (#24)"
```

### Task 2: Rule-type enum + recreate migration (TDD via migrate gate)

Failing gate assertion: the generated DB's `alert_rules` CHECK contains the three new values (use the existing `snapshot()` checks list or a direct sqlite_master grep). Then: `AlertRuleType` union + schema enum + CHECK sql updated together; `npx drizzle-kit generate --name competitor-alert-rules`; review the recreate migration (copy column list complete, FK pragmas present); all 6 migrate tests green (live-data proves `alert_rules`/`alert_events` rows preserved). Commit.

### Task 3: Seed defaults (TDD)

New `src/lib/db/seed-defaults.test.ts`: temp DB, `seedDefaults()` twice → exactly 5 rules, ids 1–5, the three new ruleTypes with expected configs (`{"min_score":20}`, `{}`, `{"window_days":7}`), all enabled. Implement rules 3–5 in `seed-defaults.ts`. Commit.

### Task 4: Evaluator branches (TDD — the core)

Extend `alerts-evaluator.test.ts` (fresh temp DB file is shared — seed the three new rules explicitly alongside the existing `hot` rule; assertions filter per rule id):

- **new_prospect**: prospect company (competitor aggregate 40 today, no own row) → fires once with company+competitor+score in title/detail; engaged company with competitor 40 + own 5 today → does NOT fire; second `evaluateAlerts()` within debounce → still exactly 1.
- **battleground_shift**: company A engaged yesterday (own only) + both today → fires "started engaging competitor"; company B prospect yesterday (competitor only) + both today → fires "started engaging our repos"; company C both yesterday + both today → silent.
- **competitor_employee_engagement**: tagged user with a star on an OWN repo (collected now) → fires once with login+competitor+repo; untagged user same events → silent; tagged user with events only on the competitor repo → silent; re-run → debounced.

Implementation in `evaluateAlerts()`: three new `if (rule.ruleType === ...)` blocks following the existing style (raw `sql` queries, per-target debounce check, `alertEvents` insert with metadata JSON). A small helper `topCompetitorFor(db, companyId)` returns the competitor name with the highest latest per-repo score or signal count (used in both company rules' detail). Commit.

### Task 5: Alerts page labels

`RULE_TYPE_LABELS` gains: `new_prospect: "New prospect"`, `battleground_shift: "Battleground shift"`, `competitor_employee_engagement: "Competitor employee engagement"` (compile-forced). Lint/build. Commit.

### Task 6: Docs + verify + demo + PR/merge

CLAUDE.md: one sentence on the seven rule types + scope-aware evaluation. Full suite/lint/build. Demo on DB copy: seed competitor aggregate for a fresh company + run `seedDefaults()` + `evaluateAlerts()` twice → alerts API shows exactly one "New prospect" alert (debounce held); alerts page headless render shows it. Teardown. PR (per-AC table, 5 ACs; recreate-migration note) + merge; confirm #24 closed → **the #17 series is complete**.

---

## Self-Review

1. **AC coverage:** three types × fire-once-in-debounce → Task 4 matrix; seed idempotent + page-configurable → Tasks 3+5; context-rich events → Task 4 (title/detail/metadata assertions); both shift directions → Task 4 (A and B cases); employee alerts own-repos-only + tagged-only → Task 4 negative cases.
2. **Placeholders:** Task 4 names exact test cases and the implementation pattern (existing evaluator style); full code written at execution against the pinned matrix.
3. **Types:** union ∪ CHECK ∪ labels ∪ seed ruleTypes all use identical strings.
