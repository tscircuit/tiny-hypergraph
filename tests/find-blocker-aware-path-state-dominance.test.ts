import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "lib/find-distinct-owner-blocker-path"
import { findBlockerAwarePath } from "lib/find-blocker-aware-path"

test("retains one best cost per topology state", () => {
  type State = "start" | "left" | "right" | "shared" | "goal"
  const hopsByState: Record<
    State,
    Array<DistinctOwnerBlockerHop<State, string>>
  > = {
    start: [
      { state: "left", distance: 1, owners: ["route-1"] },
      { state: "right", distance: 2, owners: ["route-2"] },
    ],
    left: [{ state: "shared", distance: 1 }],
    right: [{ state: "shared", distance: 1 }],
    shared: [{ state: "goal", distance: 1 }],
    goal: [],
  }

  const result = findBlockerAwarePath({
    start: "start" as State,
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => hopsByState[state],
    getDistanceHeuristic: () => 0,
    blockerCrossingPenalty: 10,
  })

  expect(result.found && result.states).toEqual([
    "start",
    "left",
    "shared",
    "goal",
  ])
  expect(result.found && [...result.owners]).toEqual(["route-1"])
  expect(result.expandedLabelCount).toBe(4)
})
