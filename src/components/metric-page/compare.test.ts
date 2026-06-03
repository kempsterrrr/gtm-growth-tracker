import { describe, it, expect } from "vitest";
import {
  competitorSeriesKey,
  competitorLabel,
  competitorColor,
  mergeCompareRows,
  type CompareSeries,
} from "./compare";

describe("compare transforms", () => {
  it("builds stable series keys and competitor-prefixed labels", () => {
    expect(competitorSeriesKey(7)).toBe("competitor_7");
    expect(
      competitorLabel({ id: 7, name: "rival-pkg", displayName: "Rival", competitor: "Acme" })
    ).toBe("Acme — Rival");
    expect(
      competitorLabel({ id: 8, name: "them/repo", displayName: null, competitor: "Acme" })
    ).toBe("Acme — them/repo");
  });

  it("cycles overlay colors through chart-3/5/4", () => {
    expect(competitorColor(0)).toBe("var(--chart-3)");
    expect(competitorColor(1)).toBe("var(--chart-5)");
    expect(competitorColor(2)).toBe("var(--chart-4)");
    expect(competitorColor(3)).toBe("var(--chart-3)");
  });

  it("merges competitor series onto own rows by date, keeps disjoint dates, sorts ascending", () => {
    const own = [
      { date: "2026-06-01", downloads: 10 },
      { date: "2026-06-03", downloads: 30 },
    ];
    const series: CompareSeries[] = [
      {
        key: "competitor_7",
        label: "Acme — Rival",
        color: "var(--chart-3)",
        rows: [
          { date: "2026-06-01", value: 5 },
          { date: "2026-06-02", value: 6 },
        ],
      },
    ];
    expect(mergeCompareRows(own, series)).toEqual([
      { date: "2026-06-01", downloads: 10, competitor_7: 5 },
      { date: "2026-06-02", competitor_7: 6 },
      { date: "2026-06-03", downloads: 30 },
    ]);
  });

  it("returns own rows untouched for an empty series list", () => {
    const own = [{ date: "2026-06-01", downloads: 10 }];
    expect(mergeCompareRows(own, [])).toEqual(own);
  });
});
