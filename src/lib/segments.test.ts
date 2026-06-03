import { describe, it, expect } from "vitest";
import { deriveSegment } from "./segments";

describe("deriveSegment (PRD #17 segment matrix)", () => {
  it("own only → engaged", () => {
    expect(deriveSegment(12, 0)).toBe("engaged");
  });
  it("both → battleground", () => {
    expect(deriveSegment(12, 8)).toBe("battleground");
  });
  it("competitor only → prospect", () => {
    expect(deriveSegment(0, 8)).toBe("prospect");
  });
  it("neither (degenerate, unlisted companies) → engaged", () => {
    expect(deriveSegment(0, 0)).toBe("engaged");
  });
});
