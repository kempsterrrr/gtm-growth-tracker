import type { EventCategory } from "./events";
import type { AlertRuleType } from "./sales-intelligence";

/**
 * THE page ⇄ API-route contract. Every dashboard route annotates its GET
 * payload with a type from this module, and every page types its fetch
 * results with the same declarations — so a shape change on either side is a
 * compile error, not a blank chart. Existing shared domain types are
 * re-exported (referenced, never duplicated). Compile-time only by design.
 */

// Re-exported domain shapes (declared once in their home modules)
export type { TrackedEvent } from "./events";
export type {
  CompanySummary,
  CompanyDetail,
  FiredAlert,
  AlertRuleType,
} from "./sales-intelligence";

// ── /api/metrics/npm ────────────────────────────────────────────────────
export interface NpmPackageSummary {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
  growthPercent7d: number;
}
export interface DownloadRow {
  date: string;
  downloads: number;
}

// ── /api/metrics/pypi ───────────────────────────────────────────────────
export interface PypiPackageSummary {
  id: number;
  name: string;
  displayName: string | null;
  downloadsLast7d: number;
}
export interface PypiDownloadRow {
  date: string;
  downloads: number;
  categoryValue: string | null;
}

// ── /api/metrics/github ─────────────────────────────────────────────────
export interface GithubRepoSummary {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  contributors: number | null;
}
export interface GithubMetricRow {
  date: string;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  contributors: number | null;
}
export interface TrafficRow {
  date: string;
  total: number;
  unique: number;
}
export interface GithubRepoMetricsResponse {
  metrics?: GithubMetricRow[];
  clones?: TrafficRow[];
  views?: TrafficRow[];
}

// ── /api/metrics/dependencies ───────────────────────────────────────────
export interface DependencySummary {
  id: number;
  name: string;
  registry: string;
  displayName: string | null;
  dependentCount: number;
}
export interface DependencyCountRow {
  date: string;
  count: number;
}
export interface DependentRow {
  dependentName: string;
  dependentRegistry: string;
  dependentVersion: string | null;
  firstSeen: string;
}
export interface DependencyDetailResponse {
  counts: DependencyCountRow[];
  dependents: DependentRow[];
}

// ── /api/alerts/rules ───────────────────────────────────────────────────
export interface AlertRuleRow {
  id: number;
  name: string;
  description: string | null;
  ruleType: AlertRuleType;
  config: string;
  enabled: number;
  notifySlack: number;
}

// ── /api/config ─────────────────────────────────────────────────────────
export interface TrackedRepoRow {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
}
export interface TrackedPackageRow {
  id: number;
  registry: string;
  name: string;
  displayName: string | null;
  repoId: number | null;
}
export interface ConfigResponse {
  repos: TrackedRepoRow[];
  packages: TrackedPackageRow[];
}

// ── /api/settings/slack ─────────────────────────────────────────────────
export interface SlackSettingsResponse {
  configured: boolean;
  channelName: string;
  enabled: boolean;
  webhookUrlSet: boolean;
}

/** Chart-annotation rows accepted by chart wrappers — a structural subset of
 *  TrackedEvent (description may be null from the API). */
export interface ChartEventRow {
  date: string;
  title: string;
  category: EventCategory;
  description?: string | null;
}
