import { toIsoDate } from "./dates";

/** Recency decay for engagement scoring (PRD #34): an event's weight halves
 *  every DECAY_HALF_LIFE_DAYS of age, events older than DECAY_MAX_AGE_DAYS
 *  are skipped entirely, and an aggregate scoring under MIN_AGGREGATE_SCORE
 *  is treated as no signal (no row → the segment drops). These are the code
 *  defaults; issue #37 makes them operator-configurable. Depends-on signals
 *  do NOT decay — a dependency is current state, not a past event. */
export const DECAY_HALF_LIFE_DAYS = 90;
export const DECAY_MAX_AGE_DAYS = 360;
export const MIN_AGGREGATE_SCORE = 1.0;

/** 0.5^(age/halfLife), 0 at/past maxAge, clamped to 1 for future-dated
 *  events. Pure — exact powers at half-life multiples keep tests exact. */
export function decayMultiplier(
  ageDays: number,
  halfLifeDays = DECAY_HALF_LIFE_DAYS,
  maxAgeDays = DECAY_MAX_AGE_DAYS
): number {
  if (ageDays <= 0) return 1;
  if (ageDays >= maxAgeDays) return 0;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Whole-day age of an event as of todayIsoDate, preferring the recorded
 *  event date and falling back to the collection timestamp (we at least know
 *  when we first saw it). Never negative. */
export function eventAgeDays(
  eventDate: string | null,
  collectedAt: string,
  todayIsoDate: string
): number {
  const anchor = eventDate || toIsoDate(new Date(collectedAt.replace(" ", "T") + "Z"));
  const ms = new Date(todayIsoDate).getTime() - new Date(anchor).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}
