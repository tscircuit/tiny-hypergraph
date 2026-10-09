import { expect, test } from "bun:test"
import {
  type DistinctOwnerBlockerHop,
  findDistinctOwnerBlockerPath,
} from "lib/find-distinct-owner-blocker-path"

test("owner-free branches do not inherit blockers from sibling paths", () => {
  const hops: Record<string, DistinctOwnerBlockerHop<string, string>[]> = {
    start: [
      { state: "blocked-branch", distance: 1 },
      { state: "owner-free-branch", distance: 2 },
    ],
    "blocked-branch": [
      { state: "goal", distance: 1, owners: ["blocking-route"] },
    ],
    "owner-free-branch": [{ state: "goal", distance: 10 }],
    goal: [],
  }
  const result = findDistinctOwnerBlockerPath({
    start: "start",
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => hops[state]!,
  })

  if (!result.found) throw new Error(result.reason)
  expect(result.states).toEqual(["start", "owner-free-branch", "goal"])
  expect([...result.owners]).toEqual([])
  expect(result.distance).toBe(12)
})
