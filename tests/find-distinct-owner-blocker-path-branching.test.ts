import { expect, test } from "bun:test"
import {
  type DistinctOwnerBlockerHop,
  findDistinctOwnerBlockerPath,
} from "lib/find-distinct-owner-blocker-path"

test("owner-free branches do not inherit blockers discovered on sibling paths", () => {
  const hops: Record<string, DistinctOwnerBlockerHop<string, string>[]> = {
    start: [
      { state: "left", distance: 1 },
      { state: "right", distance: 2 },
    ],
    left: [{ state: "goal", distance: 1, owners: ["blocked"] }],
    right: [{ state: "goal", distance: 10 }],
    goal: [],
  }
  const result = findDistinctOwnerBlockerPath({
    start: "start",
    getStateKey: (state): string => state,
    isGoal: (state): boolean => state === "goal",
    getHops: (state): DistinctOwnerBlockerHop<string, string>[] => hops[state],
  })
  expect(result.found).toBe(true)
  if (!result.found) throw new Error(result.reason)
  expect(result.states).toEqual(["start", "right", "goal"])
  expect([...result.owners]).toEqual([])
  expect(result.distance).toBe(12)
})
