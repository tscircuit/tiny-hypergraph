import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "lib/find-distinct-owner-blocker-path"
import { findBlockerAwarePath } from "lib/find-blocker-aware-path"

test("balances path length against crossing committed routes", () => {
  type State = "start" | "short" | "long" | "goal"
  const hopsByState: Record<
    State,
    Array<DistinctOwnerBlockerHop<State, string>>
  > = {
    start: [
      { state: "short", distance: 1, owners: ["route-1", "route-2"] },
      { state: "long", distance: 5, owners: ["route-3"] },
    ],
    short: [{ state: "goal", distance: 1 }],
    long: [{ state: "goal", distance: 5 }],
    goal: [],
  }

  const result = findBlockerAwarePath({
    start: "start" as State,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => hopsByState[state],
    getDistanceHeuristic: () => 0,
    blockerCrossingPenalty: 20,
  })

  expect(result.found).toBe(true)
  expect(result.found && result.states).toEqual(["start", "long", "goal"])
  expect(result.found && [...result.owners]).toEqual(["route-3"])
  expect(result.expandedLabelCount).toBe(2)
})
