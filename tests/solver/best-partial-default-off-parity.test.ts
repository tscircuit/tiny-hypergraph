import { expect, test } from "bun:test"
import { getTinyHyperGraphSolverOptions } from "lib/core"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("unspecified and disabled partial retention preserve the original routing and final attempts", () => {
  const omitted = createFinalRouteCompletionHarness("partial")
  const disabled = createFinalRouteCompletionHarness("partial", false)
  expect(getTinyHyperGraphSolverOptions(omitted.solver)).toEqual(getTinyHyperGraphSolverOptions(disabled.solver))
  for (const harness of [omitted, disabled]) {
    const { solver } = harness
    while (solver.state.unroutedRoutes.includes(1) || solver.state.currentRouteId === 1) solver.step()
    solver.state.ripCount = 22
    solver.resetRoutingStateForRerip()
    solver.state.ripCount = 32
    solver.tryFinalAcceptance()
    expect(solver.stats.retainedPartialRouteCount).toBeUndefined()
  }
  expect(omitted.solver.solved).toBe(disabled.solver.solved)
  expect(omitted.solver.failed).toBe(disabled.solver.failed)
  expect(omitted.solver.state.regionSegments).toEqual(disabled.solver.state.regionSegments)
  expect(omitted.solver.state.regionIntersectionCaches).toEqual(disabled.solver.state.regionIntersectionCaches)
  expect(omitted.solver.state.portAssignment).toEqual(disabled.solver.state.portAssignment)
  expect(omitted.solver.iterations).toBe(disabled.solver.iterations)
  expect(omitted.solver.stats).toEqual(disabled.solver.stats)
  expect(omitted.observations).toEqual(disabled.observations)
  expect(omitted.observations[0]!.remainingRouteIds).toHaveLength(5)
})
