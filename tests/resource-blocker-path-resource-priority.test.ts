import { expect, test } from "bun:test"
import { findResourceBlockerPath } from "../lib/findResourceBlockerPath"
import type { DistinctOwnerBlockerHop } from "../lib/find-distinct-owner-blocker-path"

test("prefers free resources before distance and includes shared blockers once", () => {
  const hops: Record<string, Array<DistinctOwnerBlockerHop<string, string>>> = {
    start: [
      { state: "short", distance: 1, owners: ["first", "second"] },
      { state: "long", distance: 20, owners: ["shared"] },
    ],
    short: [{ state: "goal", distance: 1, owners: ["third"] }],
    long: [{ state: "goal", distance: 20, owners: ["shared"] }],
    goal: [],
  }
  const result = findResourceBlockerPath({
    start: "start",
    getStateKey: (state): string => state,
    isGoal: (state): boolean => state === "goal",
    getHops: (state): Array<DistinctOwnerBlockerHop<string, string>> =>
      hops[state]!,
  })

  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected a complete blocker path")
  expect(result.states).toEqual(["start", "long", "goal"])
  expect(result.distance).toBe(40)
  expect(result.owners).toEqual(new Set(["shared"]))
})
