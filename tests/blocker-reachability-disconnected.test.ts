import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("rejects a disconnected owner-branching graph after visiting each state once", () => {
  const branchCount = 16
  const visits = new Map<number, number>()
  const result = findDistinctOwnerBlockerPath({
    start: 0,
    getStateKey: (state) => state,
    isGoal: (state) => state === branchCount + 1,
    getHops: (state) => {
      visits.set(state, (visits.get(state) ?? 0) + 1)
      if (state === branchCount) return []
      // Each branch adds a different owner, producing incomparable owner sets
      // at the same state in the weighted search.
      return [
        { state: state + 1, distance: 1, owners: [`left-${state}`] },
        { state: state + 1, distance: 1, owners: [`right-${state}`] },
      ]
    },
    checkReachability: true,
  })

  expect(result).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: branchCount + 1,
  })
  expect(visits.size).toBe(branchCount + 1)
  expect([...visits.values()]).toEqual(Array(branchCount + 1).fill(1))
})
