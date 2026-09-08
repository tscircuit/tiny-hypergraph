import { expect, test } from "bun:test"
import { findResourceBlockerPath } from "../lib/findResourceBlockerPath"
import type { DistinctOwnerBlockerHop } from "../lib/find-distinct-owner-blocker-path"

test("bounds a branching blocker search while returning every path owner", () => {
  const stageCount = 16
  const result = findResourceBlockerPath<number, number, string>({
    start: 0,
    getStateKey: (state): number => state,
    isGoal: (state): boolean => state === stageCount * 3,
    getHops: (state): Array<DistinctOwnerBlockerHop<number, string>> => {
      const stage = Math.floor(state / 3)
      if (stage === stageCount) return []
      if (state % 3 !== 0) {
        return [{ state: (stage + 1) * 3, distance: 1 }]
      }
      return [
        { state: state + 1, distance: 0, owners: [`left-${stage}`] },
        { state: state + 2, distance: 0, owners: [`right-${stage}`] },
      ]
    },
    maxExpandedLabels: stageCount * 3 + 1,
  })

  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected a complete blocker path")
  expect(result.distance).toBe(stageCount)
  expect(result.states[0]).toBe(0)
  expect(result.states.at(-1)).toBe(stageCount * 3)
  expect(result.owners).toEqual(
    new Set(Array.from({ length: stageCount }, (_, stage) => `left-${stage}`)),
  )
  expect(result.expandedLabelCount).toBeLessThanOrEqual(stageCount * 3 + 1)
})
