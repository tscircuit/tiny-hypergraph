import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"

test("a truncated reachability check defers to the original weighted-search budget", () => {
  type State = "start" | "dead-end" | "gate" | "goal"
  const hops: Record<State, DistinctOwnerBlockerHop<State, string>[]> = {
    start: [
      { state: "dead-end", distance: 100 },
      { state: "gate", distance: 1 },
    ],
    "dead-end": [],
    gate: [{ state: "goal", distance: 1 }],
    goal: [],
  }
  const options = {
    start: "start" as State,
    getStateKey: (state: State) => state,
    isGoal: (state: State) => state === "goal",
    getHops: (state: State) => hops[state],
    maxExpandedLabels: 2,
  }
  const original = findDistinctOwnerBlockerPath(options)
  const checked = findDistinctOwnerBlockerPath({
    ...options,
    checkReachability: true,
  })

  expect(checked).toEqual(original)
  expect(checked.found).toBeTrue()
  if (!checked.found) throw new Error("Expected a path")
  expect(checked.expandedLabelCount).toBe(2)
  expect(checked.states).toEqual(["start", "gate", "goal"])

  expect(
    findDistinctOwnerBlockerPath({
      ...options,
      maxExpandedLabels: 0,
      checkReachability: true,
    }),
  ).toEqual({ found: false, reason: "expansion_limit", expandedLabelCount: 0 })
})
