import { describe, it, expect } from "vitest";
import { toIsoDate, todayIso, daysAgoIso, growthPercent } from "./dates";

const BASE = new Date("2026-06-15T12:00:00Z");

describe("toIsoDate", () => {
  it("formats a Date as YYYY-MM-DD (UTC)", () => {
    expect(toIsoDate(BASE)).toBe("2026-06-15");
  });
});

describe("todayIso", () => {
  it("uses the base date when provided", () => {
    expect(todayIso(BASE)).toBe("2026-06-15");
  });
  it("returns a YYYY-MM-DD string for the real clock", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("daysAgoIso", () => {
  it("subtracts N days from the base date", () => {
    expect(daysAgoIso(7, BASE)).toBe("2026-06-08");
    expect(daysAgoIso(14, BASE)).toBe("2026-06-01");
    expect(daysAgoIso(0, BASE)).toBe("2026-06-15");
  });
  it("crosses month boundaries", () => {
    expect(daysAgoIso(20, BASE)).toBe("2026-05-26");
  });
});

describe("growthPercent", () => {
  it("computes percentage growth", () => {
    expect(growthPercent(110, 100)).toBe(10);
    expect(growthPercent(50, 100)).toBe(-50);
  });
  it("returns 0 when previous is 0 (existing route semantics)", () => {
    expect(growthPercent(42, 0)).toBe(0);
    expect(growthPercent(0, 0)).toBe(0);
  });
});
