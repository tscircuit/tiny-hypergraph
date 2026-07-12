import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"

type State = "start" | "shared" | "goal"

type Hop = DistinctOwnerBlockerHop<State, string>

test("prioritizes distinct owners, retains non-dominated labels, and reports exhaustion", () => {
  const hopsByState: Record<State, Hop[]> = {
    start: [
      { state: "shared", distance: 1, owners: ["owner-b"] },
      { state: "shared", distance: 10, owners: ["owner-a"] },
    ],
    shared: [{ state: "goal", distance: 1, owners: ["owner-a"] }],
    goal: [],
  }
  const result = findDistinctOwnerBlockerPath({
    start: "start" as State,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => hopsByState[state],
  })

  if (!result.found) {
    throw new Error(`Expected a path, got ${result.reason}`)
  }
  expect(result.states).toEqual(["start", "shared", "goal"])
  expect(result.hops).toEqual([hopsByState.start[1], hopsByState.shared[0]])
  expect([...result.owners]).toEqual(["owner-a"])
  expect(result.distance).toBe(11)
  expect(result.expandedLabelCount).toBe(3)

  const noPath = findDistinctOwnerBlockerPath({
    start: "start" as State,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: () => [],
  })
  expect(noPath).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 1,
  })

  const expansionLimit = findDistinctOwnerBlockerPath({
    start: "start" as State,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => hopsByState[state],
    maxExpandedLabels: 0,
  })
  expect(expansionLimit).toEqual({
    found: false,
    reason: "expansion_limit",
    expandedLabelCount: 0,
  })
})
