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
  | "new_enterprise_user";

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
  userCount: number;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
  scoreTrend: number; // change vs 7 days ago (own score)
}

// The detail route does not compute scoreTrend — the contract matches reality
export interface CompanyDetail extends Omit<CompanySummary, "scoreTrend"> {
  users: CompanyUser[];
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

export interface CompanyUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  companyRaw: string | null;
  source: CompanySource;
  confidence: number;
  engagementTypes: EngagementEventType[];
  eventCount: number;
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
