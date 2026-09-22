import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("preserves initial-goal behavior and rejects invalid limits and hop distances", () => {
  const options = {
    start: 0,
    getStateKey: (state: number) => state,
    isGoal: (state: number) => state === 0,
    getHops: () => {
      throw new Error("An initial goal must not expand hops")
    },
    checkReachability: true,
    maxExpandedLabels: 0,
  }
  const result = findDistinctOwnerBlockerPath(options)
  expect(result.found).toBe(true)
  expect(result.expandedLabelCount).toBe(0)
  expect(() =>
    findDistinctOwnerBlockerPath({ ...options, maxExpandedLabels: -1 }),
  ).toThrow("maxExpandedLabels must be a non-negative integer")

  for (const distance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      findDistinctOwnerBlockerPath({
        ...options,
        isGoal: (state: number) => state === 2,
        maxExpandedLabels: 10,
        getHops: () => [{ state: 1, distance }],
      }),
    ).toThrow("Distinct-owner blocker hops require finite distances >= 0")
  }
})
