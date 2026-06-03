import { describe, it, expect } from "vitest";
import {
  decayMultiplier,
  eventAgeDays,
  DECAY_HALF_LIFE_DAYS,
  DECAY_MAX_AGE_DAYS,
  MIN_AGGREGATE_SCORE,
} from "./decay";

describe("decayMultiplier (PRD #34 half-life semantics)", () => {
  it("returns exact powers of one half at half-life multiples", () => {
    expect(decayMultiplier(0)).toBe(1);
    expect(decayMultiplier(90)).toBe(0.5);
    expect(decayMultiplier(180)).toBe(0.25);
    expect(decayMultiplier(270)).toBe(0.125);
  });

  it("returns 0 at and beyond the max event age", () => {
    expect(decayMultiplier(360)).toBe(0);
    expect(decayMultiplier(5000)).toBe(0);
  });

  it("clamps negative ages (future-dated events) to full weight", () => {
    expect(decayMultiplier(-3)).toBe(1);
  });

  it("honors custom knobs (the #37 config path)", () => {
    expect(decayMultiplier(30, 30, 120)).toBe(0.5);
    expect(decayMultiplier(120, 30, 120)).toBe(0);
  });
});

describe("eventAgeDays", () => {
  it("measures from the event date when present", () => {
    expect(eventAgeDays("2026-05-05", "2026-06-01 10:00:00", "2026-06-04")).toBe(30);
  });

  it("falls back to the collection timestamp when the event date is null", () => {
    expect(eventAgeDays(null, "2026-06-01 10:00:00", "2026-06-04")).toBe(3);
  });

  it("never returns a negative age", () => {
    expect(eventAgeDays("2026-06-10", "2026-06-01 10:00:00", "2026-06-04")).toBe(0);
  });
});

describe("default knobs", () => {
  it("ship the grilled defaults", () => {
    expect(DECAY_HALF_LIFE_DAYS).toBe(90);
    expect(DECAY_MAX_AGE_DAYS).toBe(360);
    expect(MIN_AGGREGATE_SCORE).toBe(1.0);
  });
});
