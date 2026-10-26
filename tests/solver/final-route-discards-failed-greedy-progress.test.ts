import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("failed zero-cost greedy attempts do not replace the routing seed", () => {
  const { solver, observations } =
    createFinalRouteCompletionHarness("failed-greedy")
  const originalSegments = structuredClone(solver.state.regionSegments)
  const originalAssignments = Array.from(solver.state.portAssignment)
  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(false)
  expect(observations).toHaveLength(4)
  for (const observation of observations) {
    expect(new Set(observation.remainingRouteIds)).toEqual(new Set([1, 2, 4]))
    expect(observation.remainingRouteIds).toHaveLength(3)
    expect(observation.segments).toEqual(originalSegments)
    expect(observation.portAssignment).toEqual(originalAssignments)
    expect(observation.cacheSegmentCount).toBe(1)
    expect(observation.congestion).toEqual([0.125])
  }
  expect(solver.state.regionSegments).toEqual(originalSegments)
  expect(Array.from(solver.state.portAssignment)).toEqual(originalAssignments)
})
