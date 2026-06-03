import { describe, it, expect } from "vitest";
import { filterCompanies, sortCompanies, formatEngagementBreakdown } from "./transforms";
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
