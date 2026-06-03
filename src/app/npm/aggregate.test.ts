import { describe, it, expect } from "vitest";
import { aggregateWeekly, aggregateMonthly } from "./aggregate";

const rows = [
  { date: "2026-06-01", downloads: 10 }, // Monday
  { date: "2026-06-02", downloads: 20 },
  { date: "2026-06-08", downloads: 5 }, // next week (weeks keyed by Sunday)
  { date: "2026-07-01", downloads: 7 },
];

describe("aggregateWeekly", () => {
  it("sums downloads into Sunday-keyed weeks", () => {
    expect(aggregateWeekly(rows)).toEqual([
      { date: "2026-05-31", downloads: 30 },
      { date: "2026-06-07", downloads: 5 },
      { date: "2026-06-28", downloads: 7 },
    ]);
  });
  it("returns [] for no rows", () => {
    expect(aggregateWeekly([])).toEqual([]);
  });
});

describe("aggregateMonthly", () => {
  it("sums downloads into first-of-month keys", () => {
    expect(aggregateMonthly(rows)).toEqual([
      { date: "2026-06-01", downloads: 35 },
      { date: "2026-07-01", downloads: 7 },
    ]);
  });
});
