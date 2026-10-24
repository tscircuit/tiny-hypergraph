import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type NodeId = number
type OwnerId = number
type Hop = { state: NodeId; distance: number; owners: OwnerId[] }

test("owner and distance bounds retain goal, cutoff, owner-free and validation behavior", (): void => {
  const graph: Hop[][] = [
    [
      { state: 1, distance: 0, owners: [] },
      { state: 3, distance: 1, owners: [0] },
    ],
    [{ state: 2, distance: 0, owners: [] }],
    [{ state: 3, distance: 0, owners: [] }],
    [],
  ]
  const options = {
    start: 0,
    getStateKey: (state: NodeId): NodeId => state,
    isGoal: (state: NodeId): boolean => state === 3,
    getHops: (state: NodeId): Hop[] => graph[state]!,
    checkOwnerFreeReachability: true,
    getRemainingDistance: (): number => 0,
  }
  for (const checkReachability of [false, true]) {
    const result = findDistinctOwnerBlockerPath({ ...options, checkReachability })
    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.owners.size).toBe(0)
      expect(result.distance).toBe(0)
    }
    for (const maxExpandedLabels of [0, 1, 2]) {
      expect(
        findDistinctOwnerBlockerPath({
          ...options,
          checkReachability,
          maxExpandedLabels,
        }),
      ).toEqual({
        found: false,
        reason: "expansion_limit",
        expandedLabelCount: maxExpandedLabels,
      })
    }
    const atGoal = findDistinctOwnerBlockerPath({
      ...options,
      start: 3,
      checkReachability,
      maxExpandedLabels: 0,
    })
    expect(atGoal.found).toBe(true)
    if (atGoal.found) expect(atGoal.distance).toBe(0)
  }
  expect(
    findDistinctOwnerBlockerPath({ ...options, getHops: (): Hop[] => [] }),
  ).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 1,
  })
  for (const estimate of [-1, NaN, Infinity]) {
    expect((): unknown =>
      findDistinctOwnerBlockerPath({
        ...options,
        getRemainingDistance: (): number => estimate,
      }),
    ).toThrow("estimates must be finite")
    expect((): unknown =>
      findDistinctOwnerBlockerPath({
        ...options,
        getRemainingDistance: (state): number => (state === 0 ? 0 : estimate),
      }),
    ).toThrow("estimates must be finite")
  }
  expect((): unknown =>
    findDistinctOwnerBlockerPath({
      ...options,
      getHops: (): Hop[] => [{ state: 3, distance: -1, owners: [] }],
    }),
  ).toThrow("hops require finite distances")
  const expensiveOwnerFreePrefix: Hop[][] = [
    [
      { state: 1, distance: 10, owners: [] },
      { state: 3, distance: 1, owners: [0] },
    ],
    [{ state: 2, distance: 10, owners: [] }],
    [{ state: 3, distance: 10, owners: [] }],
    [],
  ]
  expect(
    findDistinctOwnerBlockerPath({
      ...options,
      maxExpandedLabels: 2,
      getHops: (state): Hop[] => expensiveOwnerFreePrefix[state]!,
    }),
  ).toEqual({ found: false, reason: "expansion_limit", expandedLabelCount: 2 })
  expect((): unknown =>
    findDistinctOwnerBlockerPath({
      ...options,
      checkOwnerFreeReachability: false,
      getHops: (): Hop[] => [{ state: 1, distance: Number.MAX_VALUE, owners: [] }],
      getRemainingDistance: (state): number =>
        state === 0 ? 0 : Number.MAX_VALUE,
    }),
  ).toThrow("estimates must be finite")
})
