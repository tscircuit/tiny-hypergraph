import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type Hop = { state: number; distance: number; owners: number[] }

test("dominated queued labels preserve stable expansion order and expansion limits", () => {
  const graph: Hop[][] = [
    [
      {state: 5, distance: 50, owners: [0]},
      {state: 5, distance: 40, owners: [1]},
      {state: 5, distance: 30, owners: [2]},
      {state: 4, distance: 100, owners: []},
      {state: 1, distance: 1, owners: []},
      {state: 2, distance: 1, owners: []},
      {state: 3, distance: 1, owners: []},
    ],
    [{state: 4, distance: 70, owners: []}],
    [{state: 4, distance: 40, owners: []}],
    [{state: 4, distance: 1, owners: []}],
    [{state: 5, distance: 1, owners: []}],
    [{state: 6, distance: 1, owners: []}],
    [],
  ]
  for (let limit = 0; limit <= 7; limit++) {
    const expanded: number[] = []
    const result = findDistinctOwnerBlockerPath({
      start: 0,
      getStateKey: (state): number => state,
      isGoal: (state): boolean => state === 6,
      getHops: (state): Hop[] => {
        expanded.push(state)
        return graph[state]!
      },
      maxExpandedLabels: limit,
    })
    expect(expanded).toEqual([0, 1, 2, 3, 4, 5].slice(0, limit))
    if (limit < 6) {
      expect(result).toEqual({found: false, reason: "expansion_limit", expandedLabelCount: limit})
    } else {
      expect(result.found).toBe(true)
      if (!result.found) throw new Error("Expected a successful path")
      expect(result.states).toEqual([0, 3, 4, 5, 6])
      expect(result.distance).toBe(4)
      expect([...result.owners]).toEqual([])
      expect(result.expandedLabelCount).toBe(6)
      expect(result.hops).toEqual([graph[0]![6], graph[3]![0], graph[4]![0], graph[5]![0]])
    }
  }
})
