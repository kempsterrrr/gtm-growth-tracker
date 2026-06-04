import { describe, it, expect } from "vitest";
import { filterPeopleByEntity, filterPeopleByActivity, sortPeople } from "./transforms";
import type { PersonSummary, EntityEngagement } from "@/lib/types/api";

const engagement = (entity: string, lastAt: string | null): EntityEngagement => ({
  entity,
  displayName: null,
  competitor: null,
  starCount: 1,
  forkCount: 0,
  issueCount: 0,
  prCount: 0,
  commitCount: 0,
  lastAt,
});

const person = (over: Partial<PersonSummary>): PersonSummary => ({
  id: 1,
  login: "x",
  name: null,
  avatarUrl: null,
  primaryCompany: null,
  competitorEmployee: null,
  competitorEmployeeSource: null,
  engagements: [],
  lastActive: null,
  ...over,
});

describe("filterPeopleByEntity", () => {
  const list = [
    person({ id: 1, engagements: [engagement("us/own-repo", "2026-06-01")] }),
    person({ id: 2, engagements: [engagement("pinata/pinata-sdk", "2026-05-01")] }),
    person({ id: 3 }),
  ];
  it("null passes all; a label narrows to people who touched it", () => {
    expect(filterPeopleByEntity(list, null).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(filterPeopleByEntity(list, "us/own-repo").map((p) => p.id)).toEqual([1]);
  });
});

describe("filterPeopleByActivity", () => {
  const TODAY = "2026-06-04";
  const list = [
    person({ id: 1, lastActive: "2026-06-01" }), // 3d
    person({ id: 2, lastActive: "2026-04-01" }), // 64d
    person({ id: 3, lastActive: null }),
  ];
  it("windows anchor on lastActive; null never passes a window", () => {
    expect(filterPeopleByActivity(list, "all", TODAY).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(filterPeopleByActivity(list, "90d", TODAY).map((p) => p.id)).toEqual([1, 2]);
    expect(filterPeopleByActivity(list, "30d", TODAY).map((p) => p.id)).toEqual([1]);
  });
});

describe("sortPeople", () => {
  const list = [
    person({ id: 1, login: "zeta", lastActive: "2026-05-01", primaryCompany: { id: 1, name: "Beta Inc", source: "email_domain" } }),
    person({ id: 2, login: "Alpha", lastActive: null, primaryCompany: null }),
    person({ id: 3, login: "mid", lastActive: "2026-06-01", primaryCompany: { id: 2, name: "acme", source: "org_membership" } }),
  ];
  it("lastActive desc keeps nulls last", () => {
    expect(sortPeople(list, { key: "lastActive", dir: "desc" }).map((p) => p.id)).toEqual([3, 1, 2]);
  });
  it("login sorts case-insensitively", () => {
    expect(sortPeople(list, { key: "login", dir: "asc" }).map((p) => p.login)).toEqual([
      "Alpha",
      "mid",
      "zeta",
    ]);
  });
  it("company sorts by primary name, companyless last", () => {
    expect(sortPeople(list, { key: "company", dir: "asc" }).map((p) => p.id)).toEqual([3, 1, 2]);
  });
});
