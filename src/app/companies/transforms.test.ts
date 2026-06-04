import { describe, it, expect } from "vitest";
import {
  filterCompanies,
  sortCompanies,
  filterByActivity,
  filterByEntity,
  latestActivity,
  formatRelativeAge,
  formatEngagementBreakdown,
  formatDependentCount,
} from "./transforms";
import type { CompanySummary } from "@/lib/types/api";

const company = (over: Partial<CompanySummary>): CompanySummary => ({
  id: 1,
  name: "x",
  domain: null,
  website: null,
  industry: null,
  employeeCount: null,
  score: 0,
  competitorScore: 0,
  segment: "engaged",
  lastOwnEngagementAt: null,
  lastCompetitorEngagementAt: null,
  activeEntities: [],
  userCount: 0,
  starCount: 0,
  forkCount: 0,
  issueCount: 0,
  prCount: 0,
  commitCount: 0,
  scoreTrend: 0,
  ...over,
});

describe("filterCompanies", () => {
  const list = [
    company({ id: 1, segment: "engaged" }),
    company({ id: 2, segment: "battleground" }),
    company({ id: 3, segment: "prospect" }),
  ];
  it("'all' passes everything through", () => {
    expect(filterCompanies(list, "all").map((c) => c.id)).toEqual([1, 2, 3]);
  });
  it("narrows to one segment", () => {
    expect(filterCompanies(list, "prospect").map((c) => c.id)).toEqual([3]);
  });
});

describe("sortCompanies", () => {
  const list = [
    company({ id: 1, score: 10, competitorScore: 50 }),
    company({ id: 2, score: 30, competitorScore: 5 }),
    company({ id: 3, score: 20, competitorScore: 20 }),
  ];
  it("null sort keeps the API order", () => {
    expect(sortCompanies(list, null).map((c) => c.id)).toEqual([1, 2, 3]);
  });
  it("sorts by own score desc and asc", () => {
    expect(sortCompanies(list, { key: "score", dir: "desc" }).map((c) => c.id)).toEqual([2, 3, 1]);
    expect(sortCompanies(list, { key: "score", dir: "asc" }).map((c) => c.id)).toEqual([1, 3, 2]);
  });
  it("sorts by competitor score without mutating the input", () => {
    const sorted = sortCompanies(list, { key: "competitorScore", dir: "desc" });
    expect(sorted.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(list.map((c) => c.id)).toEqual([1, 2, 3]);
  });
});

describe("formatEngagementBreakdown", () => {
  it("phrases counts in demand-significance order, skipping zeros", () => {
    expect(
      formatEngagementBreakdown({
        issueCount: 4,
        forkCount: 2,
        starCount: 0,
        prCount: 0,
        commitCount: 0,
      })
    ).toBe("4 issues, 2 forks");
  });
  it("handles singulars and the full set", () => {
    expect(
      formatEngagementBreakdown({
        issueCount: 1,
        forkCount: 1,
        starCount: 3,
        prCount: 1,
        commitCount: 2,
      })
    ).toBe("1 issue, 1 fork, 3 stars, 1 PR, 2 commits");
  });
  it("falls back when everything is zero", () => {
    expect(
      formatEngagementBreakdown({
        issueCount: 0,
        forkCount: 0,
        starCount: 0,
        prCount: 0,
        commitCount: 0,
      })
    ).toBe("no engagement recorded");
  });
});

describe("formatDependentCount", () => {
  it("handles singular and plural", () => {
    expect(formatDependentCount(1)).toBe("1 dependent repo");
    expect(formatDependentCount(3)).toBe("3 dependent repos");
  });
});

describe("latestActivity", () => {
  it("returns the fresher of the two sides, or null when both are missing", () => {
    expect(
      latestActivity(
        company({ lastOwnEngagementAt: "2026-06-01", lastCompetitorEngagementAt: "2026-05-20" })
      )
    ).toBe("2026-06-01");
    expect(
      latestActivity(company({ lastCompetitorEngagementAt: "2026-05-20" }))
    ).toBe("2026-05-20");
    expect(latestActivity(company({}))).toBeNull();
  });
});

describe("filterByActivity (windows anchored on a given today)", () => {
  const TODAY = "2026-06-04";
  const list = [
    company({ id: 1, lastOwnEngagementAt: "2026-06-01" }), // 3d
    company({ id: 2, lastCompetitorEngagementAt: "2026-04-01" }), // 64d
    company({ id: 3, lastOwnEngagementAt: "2025-09-01" }), // ~9mo
    company({ id: 4 }), // no timestamps (deps-only)
  ];
  it("'all' passes everything", () => {
    expect(filterByActivity(list, "all", TODAY).map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });
  it("'90d' keeps companies active in the window", () => {
    expect(filterByActivity(list, "90d", TODAY).map((c) => c.id)).toEqual([1, 2]);
  });
  it("'30d' narrows further and drops timestamp-less companies", () => {
    expect(filterByActivity(list, "30d", TODAY).map((c) => c.id)).toEqual([1]);
  });
});

describe("formatRelativeAge", () => {
  const TODAY = "2026-06-04";
  it("phrases ages human-first", () => {
    expect(formatRelativeAge("2026-06-04", TODAY)).toBe("today");
    expect(formatRelativeAge("2026-06-03", TODAY)).toBe("1d ago");
    expect(formatRelativeAge("2026-05-20", TODAY)).toBe("15d ago");
    expect(formatRelativeAge("2026-03-04", TODAY)).toBe("3mo ago");
    expect(formatRelativeAge("2024-06-04", TODAY)).toBe("2y ago");
  });
});

describe("sortCompanies by lastActive", () => {
  const list = [
    company({ id: 1, lastOwnEngagementAt: "2026-05-01" }),
    company({ id: 2 }), // null — always last
    company({ id: 3, lastCompetitorEngagementAt: "2026-06-01" }),
  ];
  it("desc puts freshest first, nulls last", () => {
    expect(sortCompanies(list, { key: "lastActive", dir: "desc" }).map((c) => c.id)).toEqual([
      3, 1, 2,
    ]);
  });
  it("asc puts oldest first, nulls still last", () => {
    expect(sortCompanies(list, { key: "lastActive", dir: "asc" }).map((c) => c.id)).toEqual([
      1, 3, 2,
    ]);
  });
});

describe("filterByEntity", () => {
  const list = [
    company({ id: 1, activeEntities: ["us/own-repo", "pinata-js"] }),
    company({ id: 2, activeEntities: ["pinata/pinata-sdk"] }),
    company({ id: 3 }),
  ];
  it("null passes everything; a label narrows to companies active on it", () => {
    expect(filterByEntity(list, null).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(filterByEntity(list, "pinata-js").map((c) => c.id)).toEqual([1]);
    expect(filterByEntity(list, "pinata/pinata-sdk").map((c) => c.id)).toEqual([2]);
  });
});

describe("sortCompanies by name, users, trend", () => {
  const list = [
    company({ id: 1, name: "zeta", userCount: 1, scoreTrend: -2 }),
    company({ id: 2, name: "Alpha", userCount: 5, scoreTrend: 3 }),
    company({ id: 3, name: "mid", userCount: 3, scoreTrend: 0 }),
  ];
  it("name sorts case-insensitively", () => {
    expect(sortCompanies(list, { key: "name", dir: "asc" }).map((c) => c.name)).toEqual([
      "Alpha",
      "mid",
      "zeta",
    ]);
  });
  it("users and trend sort numerically", () => {
    expect(sortCompanies(list, { key: "users", dir: "desc" }).map((c) => c.id)).toEqual([2, 3, 1]);
    expect(sortCompanies(list, { key: "trend", dir: "asc" }).map((c) => c.id)).toEqual([1, 3, 2]);
  });
});
