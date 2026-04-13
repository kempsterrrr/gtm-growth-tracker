import type { EngagementEventType } from "./sales-intelligence";

export const ENGAGEMENT_WEIGHTS: Record<EngagementEventType, number> = {
  star: 1,
  fork: 2,
  issue: 3,
  issue_comment: 3,
  pr: 5,
  pr_review: 5,
  commit: 10,
};

export const ENRICHMENT_PRIORITY: Record<EngagementEventType, number> = {
  star: 1,
  fork: 2,
  issue: 3,
  issue_comment: 4,
  pr: 5,
  pr_review: 6,
  commit: 10,
};

export const BREADTH_BONUS_PER_USER = 2;
export const MAX_EVENTS_PER_TYPE = 5;
