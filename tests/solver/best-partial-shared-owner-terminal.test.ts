import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("retained same-owner branches keep their shared terminal and native port permissions", () => {
  const { solver, observations } = createFinalRouteCompletionHarness("none", true)
  solver.problem.routeNet[1] = 0
  solver.problem.routeStartPort[1] = 0
  solver.problem.portNetId![3] = 0
  while (solver.state.unroutedRoutes.includes(1) || solver.state.currentRouteId === 1) solver.step()
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1], [1, 0, 3]])
  solver.state.ripCount = 22
  solver.resetRoutingStateForRerip()
  solver.state.ripCount = 32
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(observations[0]!.segments).toEqual([[[0, 0, 1], [1, 0, 3]]])
  expect(observations[0]!.remainingRouteIds).toEqual([2, 4])
  expect(solver.state.portAssignment[0]).toBe(0)
  expect(solver.state.portAssignment[3]).toBe(0)
  for (let port = 0; port < solver.topology.portCount; port++) {
    const assigned = solver.state.portAssignment[port]!
    expect(assigned === -1 || assigned === solver.problem.portNetId![port]).toBe(true)
  }
})
