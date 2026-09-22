import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"

test("preserves minimum distinct owners, non-dominated labels, and distance tie breaks", () => {
  const hops: Record<string, DistinctOwnerBlockerHop<string, string>[]> = {
    start: [
      { state: "shared", distance: 1, owners: ["other"] },
      { state: "shared", distance: 10, owners: ["needed"] },
      { state: "detour", distance: 6, owners: ["needed"] },
    ],
    shared: [{ state: "goal", distance: 1, owners: ["needed"] }],
    detour: [{ state: "goal", distance: 6, owners: ["needed"] }],
    goal: [],
  }
  const options = {
    start: "start",
    getStateKey: (state: string) => state,
    isGoal: (state: string) => state === "goal",
    getHops: (state: string) => hops[state]!,
    maxExpandedLabels: 100,
  }
  const original = findDistinctOwnerBlockerPath(options)
  const checked = findDistinctOwnerBlockerPath({
    ...options,
    checkReachability: true,
  })

  expect(checked).toEqual(original)
  expect(checked.found).toBe(true)
  if (!checked.found) throw new Error("Expected a reachable goal")
  expect(checked.states).toEqual(["start", "shared", "goal"])
  expect([...checked.owners]).toEqual(["needed"])
  expect(checked.distance).toBe(11)
})
