import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("retaining progress also queues a legally reripped original seed", () => {
  const { solver, observations, initialAssignments } =
    createFinalRouteCompletionHarness("reripped-seed")
  const originalAssignments = structuredClone(initialAssignments)
  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(observations[0].remainingRouteIds).toEqual([4, 0])
  expect(observations[0].segments).toEqual([
    [
      [1, 2, 3],
      [2, 4, 5],
    ],
  ])
  expect(observations[0].portAssignment).toEqual([
    -1, -1, 1, 1, 2, 2, -1, -1, -1,
  ])
  expect(observations[0].cacheSegmentCount).toBe(2)
  expect(initialAssignments).toEqual(originalAssignments)
  expect(solver.state.regionSegments).toEqual([
    [
      [1, 2, 3],
      [2, 4, 5],
      [4, 7, 8],
      [0, 0, 1],
    ],
  ])
  expect(
    new Set(solver.state.regionSegments[0].map(([routeId]) => routeId)),
  ).toEqual(new Set([0, 1, 2, 4]))
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(observations[0].remainingRouteIds).not.toContain(3)
})
