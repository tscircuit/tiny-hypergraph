import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("a completed zero-length seed stays complete without owning a segment", () => {
  const { solver, observations } = createFinalRouteCompletionHarness("partial")
  expect(solver.problem.routeStartPort[3]).toBe(solver.problem.routeEndPort[3])
  expect(solver.state.unroutedRoutes).not.toContain(3)
  expect(
    solver.state.regionSegments.flat().some(([routeId]) => routeId === 3),
  ).toBe(false)
  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(observations[0].remainingRouteIds).toEqual([2, 4])
  expect(observations[0].remainingRouteIds).not.toContain(3)
  expect(
    solver.state.regionSegments.flat().some(([routeId]) => routeId === 3),
  ).toBe(false)
  expect(solver.state.unroutedRoutes).toEqual([])
})
