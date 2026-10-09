import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type Hop = { state: number; distance: number; owners: number[] }

test("owner-union dominance preserves the optimum across overlapping blocker sets", () => {
  let seed = 7411
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let example = 0; example < 100; example++) {
    const graph: Hop[][] = Array.from({ length: 6 }, () => [])
    for (let from = 0; from < graph.length; from++) {
      for (let to = 0; to < graph.length; to++) {
        if (from === to || random() < 0.55) continue
        graph[from]!.push({
          state: to,
          distance: 1 + Math.floor(random() * 5),
          owners: Array.from({ length: 4 }, (_, owner) => owner).filter(
            () => random() < 0.35,
          ),
        })
      }
    }
    let bestOwners = Infinity
    let bestDistance = Infinity
    const visit = (
      state: number,
      owners: Set<number>,
      distance: number,
      visited: Set<number>,
    ): void => {
      if (state === 5) {
        if (
          owners.size < bestOwners ||
          (owners.size === bestOwners && distance < bestDistance)
        ) {
          bestOwners = owners.size
          bestDistance = distance
        }
        return
      }
      for (const hop of graph[state]!) {
        if (visited.has(hop.state)) continue
        visit(
          hop.state,
          new Set([...owners, ...hop.owners]),
          distance + hop.distance,
          new Set([...visited, hop.state]),
        )
      }
    }
    visit(0, new Set(), 0, new Set([0]))
    const result = findDistinctOwnerBlockerPath({
      start: 0,
      getStateKey: (state): number => state,
      isGoal: (state): boolean => state === 5,
      getHops: (state): Hop[] => graph[state]!,
    })
    expect(result.found).toBe(Number.isFinite(bestOwners))
    if (result.found) {
      expect(result.owners.size).toBe(bestOwners)
      expect(result.distance).toBe(bestDistance)
    }
  }
})
