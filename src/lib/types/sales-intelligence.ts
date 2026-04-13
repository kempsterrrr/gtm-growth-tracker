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

export interface CompanySummary {
  id: number;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: string | null;
  score: number;
  userCount: number;
  starCount: number;
  forkCount: number;
  issueCount: number;
  prCount: number;
  commitCount: number;
  scoreTrend: number; // change vs 7 days ago
}

export interface CompanyDetail extends CompanySummary {
  users: CompanyUser[];
  scoreHistory: Array<{ date: string; score: number }>;
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
  slackSent: boolean;
  acknowledged: boolean;
  firedAt: string;
}
