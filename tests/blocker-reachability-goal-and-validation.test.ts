import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("reachability preserves initial goals and search-input validation", () => {
  const options = {
    start: 0,
    getStateKey: (state: number) => state,
    isGoal: (state: number) => state === 0,
    getHops: () => {
      throw new Error("The initial goal must not expand")
    },
    maxExpandedLabels: 0,
    checkReachability: true,
  }
  const result = findDistinctOwnerBlockerPath(options)
  expect(result.found).toBeTrue()
  expect(result.expandedLabelCount).toBe(0)
  for (const maxExpandedLabels of [-1, 0.5, Number.NaN]) {
    expect(() =>
      findDistinctOwnerBlockerPath({ ...options, maxExpandedLabels }),
    ).toThrow("maxExpandedLabels must be a non-negative integer")
  }

  for (const distance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      findDistinctOwnerBlockerPath({
        ...options,
        isGoal: () => false,
        maxExpandedLabels: 10,
        getHops: () => [{ state: 1, distance }],
      }),
    ).toThrow("Distinct-owner blocker hops require finite distances >= 0")
  }
  expect(() =>
    findDistinctOwnerBlockerPath({
      ...options,
      isGoal: () => false,
      maxExpandedLabels: 10,
      getHops: (state) =>
        state < 2 ? [{ state: state + 1, distance: Number.MAX_VALUE }] : [],
    }),
  ).toThrow("Distinct-owner blocker path distance overflowed")
})
