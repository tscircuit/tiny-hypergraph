import { expect, test } from "bun:test"
import { findShortestDistanceBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("keeps one shortest blocker label per topology state", () => {
  const goalState = 64
  const result = findShortestDistanceBlockerPath({
    start: 0,
    getStateKey: (state) => state,
    isGoal: (state) => state === goalState,
    getEstimatedRemainingDistance: (state) => goalState - state,
    getHops: (state) =>
      state === goalState
        ? []
        : [
            {
              state: state + 1,
              distance: 1,
              owners: [`owner-${state}-a`],
            },
            {
              state: state + 1,
              distance: 1,
              owners: [`owner-${state}-b`],
            },
          ],
  })

  if (!result.found) {
    throw new Error(`Expected a path, got ${result.reason}`)
  }
  expect(result.distance).toBe(goalState)
  expect(result.expandedLabelCount).toBe(goalState)
  expect(result.states).toHaveLength(goalState + 1)
  expect(result.owners.size).toBe(goalState)
  expect(result.owners.has("owner-0-a")).toBeTrue()
  expect(result.owners.has("owner-0-b")).toBeFalse()
})
