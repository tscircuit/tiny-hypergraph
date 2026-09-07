import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "../lib/find-distinct-owner-blocker-path"
import { findResourceBlockerPath } from "../lib/findResourceBlockerPath"

test("negotiated resource cost can escape a repeated single-owner conflict", () => {
  const hops: Record<string, Array<DistinctOwnerBlockerHop<string, string>>> = {
    start: [
      { state: "repeated", distance: 1, owners: ["repeated-owner"] },
      { state: "fresh", distance: 2, owners: ["first", "second"] },
    ],
    repeated: [{ state: "goal", distance: 1 }],
    fresh: [{ state: "goal", distance: 2 }],
    goal: [],
  }
  const result = findResourceBlockerPath({
    start: "start",
    getStateKey: (state): string => state,
    isGoal: (state): boolean => state === "goal",
    getHops: (state): Array<DistinctOwnerBlockerHop<string, string>> =>
      hops[state]!,
    getBlockerCost: (hop): number =>
      (hop.owners ?? []).reduce(
        (cost, owner) => cost + (owner === "repeated-owner" ? 3 : 1),
        0,
      ),
  })

  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected a complete blocker path")
  expect(result.states).toEqual(["start", "fresh", "goal"])
  expect(result.owners).toEqual(new Set(["first", "second"]))
})
