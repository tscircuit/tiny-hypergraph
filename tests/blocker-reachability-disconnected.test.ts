import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("rejects a disconnected destination before enumerating incomparable owner sets", () => {
  let expandedStates = 0
  const options = {
    start: 0,
    getStateKey: (state: number) => state,
    isGoal: (state: number) => state === 100,
    getHops: (state: number) => {
      expandedStates++
      return state < 10
        ? [0, 1, 2].map((choice) => ({
            state: state + 1,
            distance: 1,
            owners: [`${state}:${choice}`],
          }))
        : []
    },
    maxExpandedLabels: 64,
  }

  expect(findDistinctOwnerBlockerPath(options)).toEqual({
    found: false,
    reason: "expansion_limit",
    expandedLabelCount: 64,
  })
  expandedStates = 0
  expect(
    findDistinctOwnerBlockerPath({ ...options, checkReachability: true }),
  ).toEqual({ found: false, reason: "no_path", expandedLabelCount: 0 })
  expect(expandedStates).toBe(11)
})
