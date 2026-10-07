import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "lib/find-distinct-owner-blocker-path"
import { findBlockerAwarePath } from "lib/find-blocker-aware-path"

test("balances path length against blocker crossings", () => {
  type State = "start" | "short" | "long" | "goal"
  const hops: Record<State, Array<DistinctOwnerBlockerHop<State, string>>> = {
    start: [
      { state: "short", distance: 1, owners: ["route-1", "route-2"] },
      { state: "long", distance: 5, owners: ["route-3"] },
    ],
    short: [{ state: "goal", distance: 1, owners: [] }],
    long: [{ state: "goal", distance: 5, owners: [] }],
    goal: [],
  }

  const result = findBlockerAwarePath({
    start: "start" as State,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => hops[state],
    blockerCrossingPenalty: 20,
  })

  expect(result.found).toBe(true)
  expect(result.found && result.states).toEqual(["start", "long", "goal"])
  expect(result.found && [...result.owners]).toEqual(["route-3"])

  type ConvergingState = "start" | "early" | "late" | "merge" | "goal"
  const convergingHops: Record<
    ConvergingState,
    Array<DistinctOwnerBlockerHop<ConvergingState, string>>
  > = {
    start: [
      { state: "early", distance: 1 },
      { state: "late", distance: 50 },
    ],
    early: [{ state: "merge", distance: 100 }],
    late: [{ state: "merge", distance: 1 }],
    merge: [{ state: "goal", distance: 1 }],
    goal: [],
  }
  const convergingResult = findBlockerAwarePath({
    start: "start" as ConvergingState,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => convergingHops[state],
    blockerCrossingPenalty: 20,
  })

  expect(convergingResult.found && convergingResult.states).toEqual([
    "start",
    "late",
    "merge",
    "goal",
  ])
})
