import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("greedy completion retains routes completed by the cost-aware attempt", () => {
  const { solver, observations, initialAssignments } =
    createFinalRouteCompletionHarness("partial")
  const originalAssignments = structuredClone(initialAssignments)
  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(observations).toHaveLength(1)
  expect(observations[0].remainingRouteIds).toEqual([2, 4])
  expect(observations[0].segments).toEqual([
    [
      [0, 0, 1],
      [1, 2, 3],
    ],
  ])
  expect(observations[0].portAssignment).toEqual([
    0, 0, 1, 1, -1, -1, -1, -1, -1,
  ])
  expect(observations[0].cacheSegmentCount).toBe(2)
  expect(observations[0].congestion).toEqual([0.125])
  expect(observations[0].maximumIterations).toBe(50_000)
  expect(observations[0].greedyCost).toBe(7)
  expect(solver.MAX_ITERATIONS).toBe(2_000_000)
  expect(initialAssignments).toEqual(originalAssignments)
  expect(solver.state.regionSegments).toEqual([
    [
      [0, 0, 1],
      [1, 2, 3],
      [2, 4, 5],
      [4, 7, 8],
    ],
  ])
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.stats.greedyFinalRouteRemainingRouteCount).toBe(2)
})
