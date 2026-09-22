import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("a truncated reachability check does not consume or replace the weighted search budget", () => {
  const options = {
    start: 0,
    getStateKey: (state: number) => state,
    isGoal: (state: number) => state === 100,
    getHops: (state: number) =>
      state === 0
        ? [
            ...Array.from({ length: 10 }, (_, index) => ({
              state: index + 1,
              distance: 100,
              owners: [1],
            })),
            { state: 100, distance: 1, owners: [] },
          ]
        : [],
    maxExpandedLabels: 2,
  }

  const original = findDistinctOwnerBlockerPath(options)
  expect(original.found).toBe(true)
  expect(
    findDistinctOwnerBlockerPath({ ...options, checkReachability: true }),
  ).toEqual(original)
  expect(
    findDistinctOwnerBlockerPath({
      ...options,
      checkReachability: true,
      maxExpandedLabels: 0,
    }),
  ).toEqual({ found: false, reason: "expansion_limit", expandedLabelCount: 0 })
})
