import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type Hop = {state: number; distance: number; owners: number[]}

test("certified owner lower bound preserves exhaustive minimum owner count and distance", () => {
  let seed = 60813
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let example = 0; example < 250; example++) {
    const graph: Hop[][] = Array.from({length: 6}, () => [])
    for (let from = 0; from < 6; from++) {
      for (let to = 0; to < 6; to++) {
        if (from === to || random() < .65) continue
        graph[from]!.push({state: to, distance: Math.floor(random() * 6), owners: [0, 1, 2].filter(() => random() < .2)})
      }
    }
    let bestOwners = Infinity
    let bestDistance = Infinity
    const visit = (state: number, owners: Set<number>, distance: number, visited: Set<number>): void => {
      if (state === 5) {
        if (owners.size < bestOwners || (owners.size === bestOwners && distance < bestDistance)) {
          bestOwners = owners.size
          bestDistance = distance
        }
        return
      }
      for (const hop of graph[state]!) {
        if (visited.has(hop.state)) continue
        visit(hop.state, new Set([...owners, ...hop.owners]), distance + hop.distance, new Set([...visited, hop.state]))
      }
    }
    visit(0, new Set(), 0, new Set([0]))
    const options = {start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 5, getHops: (state: number): Hop[] => graph[state]!, certifyMinimumOwnerCount: true}
    const result = findDistinctOwnerBlockerPath(options)
    expect(result.found).toBe(Number.isFinite(bestOwners))
    if (result.found) {
      expect(result.owners.size).toBe(bestOwners)
      expect(result.distance).toBe(bestDistance)
    }
    const bounded = findDistinctOwnerBlockerPath({...options, maxExpandedLabels: 1})
    expect(bounded.expandedLabelCount).toBeLessThanOrEqual(1)
  }
  const goalAtStart = findDistinctOwnerBlockerPath({start: 0, getStateKey: (state): number => state, isGoal: (): boolean => true, getHops: (): Hop[] => {throw new Error("Start goal must not expand")}, certifyMinimumOwnerCount: true, maxExpandedLabels: 0})
  expect(goalAtStart).toEqual({found: true, states: [0], hops: [], owners: new Set(), distance: 0, expandedLabelCount: 0})
  const options = {start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 2, getHops: (state: number): Hop[] => state === 0 ? [{state: 1, distance: Number.MAX_VALUE, owners: []}] : [{state: 2, distance: Number.MAX_VALUE, owners: []}], certifyMinimumOwnerCount: true}
  expect(() => findDistinctOwnerBlockerPath(options)).toThrow("path distance overflowed")
  expect(() => findDistinctOwnerBlockerPath({...options, getHops: (): Hop[] => [{state: 2, distance: -1, owners: []}]})).toThrow("finite distances >= 0")
})
