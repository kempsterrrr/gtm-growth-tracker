export type EngagementEventType =
  | "star"
  | "fork"
  | "issue"
  | "pr"
  | "commit"
  | "issue_comment"
  | "pr_review";

export type CompanySource =
  | "email_domain"
  | "profile_company"
  | "org_membership"
  | "manual";

export type AlertRuleType =
  | "score_threshold"
  | "new_company"
  | "engagement_spike"
  | "new_enterprise_user"
  | "new_prospect"
  | "battleground_shift"
  | "competitor_employee_engagement";

export type CompanySegment = "engaged" | "battleground" | "prospect";

export interface CompanySummary {
  id: number;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: string | null;
  /** Own-engagement aggregate — same meaning as before dual scoring. */
  score: number;
  /** Competitor-engagement aggregate; 0 when the company has none. */
  competitorScore: number;
  /** Derived at query time from the two aggregates (PRD #17 matrix). */
  segment: CompanySegment;
  /** Newest engagement event on our repos / on competitor repos (PRD #34).
   *  Null when that side has no live (undecayed) signal — e.g. depends-on-only
   *  prospects, whose dependency is the liveness signal. */
  lastOwnEngagementAt: string | null;
  lastCompetitorEngagementAt: string | null;
  /** Entity labels this company has activity on — per-repo score rows plus
   *  depends-on packages. Drives the Companies entity filter (PRD #42); own
   *  packages carry no company-level signal and never appear. */
  activeEntities: string[];
  userCount: number;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
  scoreTrend: number; // change vs 7 days ago (own score)
}

/** One row on the People page (PRD #42): every engaged human exactly once,
 *  with their primary employer (and the signal that decided it), badges, and
 *  per-entity engagement. */
export interface PersonSummary {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  primaryCompany: { id: number; name: string; source: CompanySource } | null;
  competitorEmployee: string | null;
  competitorEmployeeSource: string | null;
  engagements: EntityEngagement[];
  lastActive: string | null;
}

/** A non-primary user-company link (PRD #42): visible context, zero score
 *  contribution. The source is the signal that created the link. */
export interface AffiliatedUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  source: CompanySource;
}

// The detail route does not compute scoreTrend — the contract matches reality
export interface CompanyDetail extends Omit<CompanySummary, "scoreTrend"> {
  /** Users whose PRIMARY company this is — the "works here" list. */
  users: CompanyUser[];
  /** Non-primary links, collapsed in the UI as "Also affiliated". */
  affiliated: AffiliatedUser[];
  scoreHistory: Array<{ date: string; score: number }>;
  /** Which competitor repos/packages drove competitorScore (latest per entity). */
  competitorAttribution: CompetitorAttributionRow[];
}

/** One competitor entity (repo today; packages join via the depends-on
 *  signal in #22) that contributed to a company's competitor score, with the
 *  engagement breakdown behind it — so outreach can reference the specific
 *  competitor product the company is using. */
export interface CompetitorAttributionRow {
  competitor: string;
  /** Repo as "owner/name"; package as registry name. */
  entity: string;
  displayName: string | null;
  /** How the signal was observed: repo engagement or package dependency. */
  signal: "engagement" | "depends_on";
  /** Dependent count behind a depends_on row; 0 for engagement rows. */
  dependentCount: number;
  score: number;
  userCount: number;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
}

/** One entity's worth of a user's engagement (PRD #42): which repo/package,
 *  what they did there (raw counts, scoring-style type buckets), whether it's
 *  a competitor's, and how recently. Replaces the old unscoped badge fields,
 *  which summed events across all repos — competitors' included. */
export interface EntityEngagement {
  /** Repo as "owner/name"; package as registry name. */
  entity: string;
  displayName: string | null;
  competitor: string | null;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
  lastAt: string | null;
}

export interface CompanyUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  companyRaw: string | null;
  source: CompanySource;
  confidence: number;
  /** Per-entity breakdown, newest activity first. */
  engagements: EntityEngagement[];
  /** Likely competitor employee (the competitor's name) — badged in the UI,
   *  excluded from competitor aggregates, never deleted. */
  competitorEmployee: string | null;
  competitorEmployeeSource: string | null;
}

export interface AlertRuleConfig {
  min_score?: number;
  min_users?: number;
  min_employee_count?: number;
  percent_increase?: number;
  window_days?: number;
  domains?: string[];
}

export interface FiredAlert {
  id: number;
  ruleId: number;
  ruleName: string;
  ruleType: AlertRuleType;
  companyId: number | null;
  companyName: string | null;
  companyDomain: string | null;
  userId: number | null;
  title: string;
  detail: string | null;
  // SQLite integers on the wire (0/1) — the contract matches reality
  slackSent: number;
  acknowledged: number;
  firedAt: string;
}
