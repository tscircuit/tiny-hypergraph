import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("retained partial work preserves an active request and a segment-free completed request", () => {
  const { solver, observations } = createFinalRouteCompletionHarness("none", true)
  while (solver.state.unroutedRoutes.includes(1) || solver.state.currentRouteId === 1) solver.step()
  solver.step()
  expect(solver.state.currentRouteId).toBe(2)
  solver.state.ripCount = 22
  solver.resetRoutingStateForRerip()
  solver.state.ripCount = 32
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(true)
  expect(observations[0]!.remainingRouteIds).toEqual([4, 2])
  expect(observations[0]!.remainingRouteIds).not.toContain(3)
  expect(solver.state.regionSegments.flat().some(([route]) => route === 3)).toBe(false)
  expect(solver.state.unroutedRoutes).toEqual([])
})
