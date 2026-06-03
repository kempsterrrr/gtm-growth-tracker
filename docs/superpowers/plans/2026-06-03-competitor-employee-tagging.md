# Competitor Employee Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep competitor employees out of the prospect list without losing the "competitor is watching us" signal (GitHub issue #23, parent PRD #17): three overlapping tagging signals with recorded source, competitor-score exclusion, competitor-company prospect exclusion, and a badge wherever users are listed.

**Architecture:** Two nullable columns on `github_users` (`competitor_employee` = competitor name, `competitor_employee_source` ∈ commit_activity | org_membership | domain_match; migration `0004`). A new collector module `competitor-employees.ts` exports `tagCompetitorEmployees(config?)` — **not a new pipeline step** (PRD: #22 was the only one); it runs at the end of `resolveCompanies()` (the PRD's "during/after company resolution"), reading the optional `competitors:` config block via the config module (missing file/block → signals 1–2 only). Tagging is additive: a NULL-tagged user gets the first matching signal; existing tags are never overwritten or deleted. Scoring excludes tagged users from **competitor-scope** aggregation only (own-side engagement still counts — competitor-watching stays visible) and skips writing the competitor aggregate for companies identified as the competitor itself (name ∈ tracked competitor names ∪ domain ∈ configured domains) — so the competitor can never rank as its own prospect. `CompanyUser` gains the two fields; the detail page badges tagged users.

**Key facts pinned:**
- Signal precedence = first write wins in the order commit-activity → org-membership → domain-match (one pass each, `WHERE competitor_employee IS NULL`); additive metadata, never deletion (AC).
- Org-membership matching is case-insensitive on `github_user_orgs.org_login` = competitor repo owner.
- Domain matching uses **resolved company domain** (`github_user_companies` → `companies.domain`) per the PRD text.
- Scoring's competitor-company identification: distinct `competitor` names from tracked repos+packages (DB) + config domains (optional `config` param, graceful default — same pattern as tagging). Lowercased name equality + exact domain membership.
- Badge: `destructive` variant ("competitor employee") in the detail users table — visually unmissable, semantically "exclude from outreach".
- Demo mirrors the issue line: a user commits to the competitor repo AND stars ours → badged on the company detail; their employer carries no competitor aggregate → not a prospect.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-06-03-competitor-employee-tagging.md` | Create | This plan |
| `src/lib/db/schema.ts` + `drizzle/0004_*` + `migrate.test.ts` | Modify | Tagging columns |
| `src/lib/collectors/competitor-employees.ts` + `.test.ts` | Create | `tagCompetitorEmployees` (3 signals) |
| `src/lib/collectors/company-resolution.ts` | Modify | Calls tagging at the end |
| `src/lib/collectors/company-scoring.ts` + `.test.ts` | Modify | Tagged-user + competitor-company exclusion |
| `src/lib/types/sales-intelligence.ts` | Modify | `CompanyUser.competitorEmployee(+Source)` |
| `src/app/api/companies/[id]/route.ts` + `.test.ts` | Modify | Fields on the users payload |
| `src/app/companies/[id]/page.tsx` | Modify | Badge |
| `CLAUDE.md` | Modify | Conventions |

---

### Task 1: Branch + plan

```bash
git checkout -b feat/competitor-employees
git add docs/superpowers/plans/2026-06-03-competitor-employee-tagging.md
git commit -m "docs: implementation plan for competitor employee tagging (#23)"
```

### Task 2: Tagging columns + migration (TDD via migrate-gate assertion, prior art #18/#19)

Schema (`githubUsers`, after `twitterUsername`):

```ts
  /** Likely competitor employee: the competitor's name, with the signal that
   *  tagged them. Additive metadata — never deleted, set once. */
  competitorEmployee: text("competitor_employee"),
  competitorEmployeeSource: text("competitor_employee_source", {
    enum: ["commit_activity", "org_membership", "domain_match"],
  }),
```

Migrate-gate assertion (both columns, notnull 0), `npx drizzle-kit generate --name competitor-employee-tagging` (two plain ALTERs), suite green, commit.

### Task 3: The tagging collector (TDD)

Test seeds (fresh temp DB): competitor repo (owner `pinata`, competitor `Pinata`) + own repo; users: `committer` (commit on competitor repo + star on ours), `org-member` (in org `Pinata` via github_user_orgs, no competitor events), `domain-hire` (linked to a company with domain `pinata.cloud`), `clean-prospect` (issue on competitor repo only); config injected as `{ competitors: { Pinata: { domains: ["pinata.cloud"] } }, ... }`. Assert: three tagged with correct competitor + source; `clean-prospect` untagged; re-run doesn't change sources (additive); run with `undefined` config still tags signals 1–2.

Implementation sketch (`competitor-employees.ts`):

```ts
export async function tagCompetitorEmployees(config?: GtmConfig) — 
  resolvedConfig = config ?? (fs.existsSync(defaultPath) ? readConfig() : undefined)
  competitorRepos = tracked repos WHERE competitor IS NOT NULL
  // signal 1: commit/pr/pr_review events on competitor repos
  UPDATE github_users SET competitor_employee = :name, source='commit_activity'
    WHERE id IN (SELECT user_id FROM engagement_events WHERE repo_id=:repoId AND event_type IN (...))
      AND competitor_employee IS NULL
  // signal 2: org_login = repo owner (case-insensitive)
  // signal 3: resolved company domain ∈ configured domains per competitor
  log counts
```

(Real implementation uses drizzle `sql` updates per competitor repo / domain set; full code written at execution following these exact semantics.) `resolveCompanies()` gains `await tagCompetitorEmployees();` as its final line (import at top). Commit.

### Task 4: Scoring exclusion (TDD)

Extend `company-scoring.test.ts`: tag `u2` as competitor employee (direct SQL) → competitor repo aggregates drop u2's contributions (it already contributes 0 score but its commit_count disappears too — assert commit_count 0 and user u1-only); add an own-side assertion (tagged user's OWN engagement still counts — u2 has no own events; add tag on u1 instead? Careful: u1 drives both sides. Design test: tag a NEW user u3 with issue on competitor repo + star on own repo → competitor aggregate excludes u3's 8, own aggregate includes u3's 1). Competitor-company exclusion: company named `Acme` (matching the tracked competitor name) with engagement on the competitor repo → no competitor-scope aggregate row written.

Implementation: load `taggedUserIds` (set) once; in the per-repo loop skip tagged users **only when scope === "competitor"**; before writing the competitor aggregate, skip if `isCompetitorCompany(company, names, domains)` (names from `allRepos`/packages distinct competitor values + config domains via optional param like tagging). Commit.

### Task 5: Contract + route + badge

`CompanyUser` gains `competitorEmployee: string | null; competitorEmployeeSource: string | null;` — detail route users select + map them; route test asserts a tagged user's fields. Detail page users table: after the login cell,

```tsx
{user.competitorEmployee && (
  <Badge variant="destructive" className="text-xs ml-2">
    {user.competitorEmployee} employee
  </Badge>
)}
```

Lint/build green, commit.

### Task 6: Docs + verify + demo + PR/merge

CLAUDE.md: tagging columns + exclusion conventions sentence. Full suite/lint/build. Demo on DB copy: seed the issue's scenario (committer on competitor repo + star on ours, plus a clean issue-filer from another company) → run tagging + scoring → API: clean company = prospect; employee's company has no competitor aggregate; detail page renders the badge (headless DOM grep). Teardown. PR (per-AC table, 5 ACs) + merge under standing authorization; confirm #23 closed.

---

## Self-Review

1. **AC coverage:** 3 signals independent + source + additive → Task 3 test matrix; excluded from aggregates/segments → Task 4 (segment derives from aggregates); competitor company excluded from prospects → Task 4 aggregate-skip; badge + contract → Task 5; config-absent degradation → Task 3 (undefined-config case).
2. **Placeholders:** Task 3 marks the SQL-update sketch as semantics-with-full-code-at-execution — acceptable here because the test matrix pins the behavior exactly; all other tasks carry full code or precise diffs.
3. **Types:** enum values `commit_activity|org_membership|domain_match` identical in schema, collector, contract docs, tests.
