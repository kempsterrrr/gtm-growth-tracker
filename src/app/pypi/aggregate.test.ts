import { describe, it, expect } from "vitest";
import { aggregateByDate } from "./aggregate";

describe("aggregateByDate", () => {
  it("sums mirror categories per date and sorts by date", () => {
    expect(
      aggregateByDate([
        { date: "2026-06-02", downloads: 5, categoryValue: "with_mirrors" },
        { date: "2026-06-01", downloads: 10, categoryValue: "with_mirrors" },
        { date: "2026-06-01", downloads: 3, categoryValue: "without_mirrors" },
      ])
    ).toEqual([
      { date: "2026-06-01", downloads: 13 },
      { date: "2026-06-02", downloads: 5 },
    ]);
  });

  it("returns [] for no rows", () => {
    expect(aggregateByDate([])).toEqual([]);
  });
});
