import type { CompanySegment } from "./types/sales-intelligence";

/** The segment matrix from PRD #17: own engagement only → engaged, both →
 *  battleground, competitor engagement only → net-new prospect. Derived at
 *  query time, never stored. (0,0) is unreachable for listed companies —
 *  they only appear with at least one aggregate — and maps to "engaged" as
 *  the least-alarming default. */
export function deriveSegment(ownScore: number, competitorScore: number): CompanySegment {
  if (competitorScore > 0 && ownScore > 0) return "battleground";
  if (competitorScore > 0) return "prospect";
  return "engaged";
}
