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

/** Signal semantics flip on competitor repos (PRD #17): demand signals rank
 *  prospects — issues high, forks medium, stars low — while supply signals
 *  (commits, PRs, reviews) identify competitor employees and carry no
 *  prospect value (weight 0; tagging/exclusion lands in #23). */
export const COMPETITOR_ENGAGEMENT_WEIGHTS: Record<EngagementEventType, number> = {
  star: 1,
  fork: 3,
  issue: 8,
  issue_comment: 8,
  pr: 0,
  pr_review: 0,
  commit: 0,
};

/** Enrichment queue: own-repo users always rank above competitor-repo users.
 *  Applied as an offset so the per-event-type ordering is preserved within
 *  the competitor band, and the queue's MAX() upsert lifts anyone who also
 *  engages our own repos into the own band. */
export const COMPETITOR_PRIORITY_OFFSET = -100;
