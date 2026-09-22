import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"

test("checks the caller's forbidden-owner graph rather than unfiltered connectivity", () => {
  const hops: Record<string, DistinctOwnerBlockerHop<string, number>[]> = {
    start: [
      { state: "approach", distance: 1, owners: [754] },
      { state: "approach", distance: 1, owners: [247] },
    ],
    approach: [{ state: "goal", distance: 1, owners: [669] }],
    goal: [],
  }
  const search = (forbidden: Set<number>) =>
    findDistinctOwnerBlockerPath({
      start: "start",
      getStateKey: (state) => state,
      isGoal: (state) => state === "goal",
      getHops: (state) =>
        hops[state]!.filter(
          (hop) => !hop.owners?.some((owner) => forbidden.has(owner)),
        ),
      checkReachability: true,
    })

  expect(search(new Set()).found).toBe(true)
  expect(search(new Set([669]))).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 0,
  })
  expect(search(new Set([754])).found).toBe(true)
})
