import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("final completion retains genuine pre-rip copper without renewing the live rerip budget", () => {
  const { solver, observations, initialAssignments } = createFinalRouteCompletionHarness("none", true)
  const originalAssignments = structuredClone(initialAssignments)
  while (solver.state.unroutedRoutes.includes(1) || solver.state.currentRouteId === 1) solver.step()
  expect(solver.state.regionIntersectionCaches[0]!.existingSegmentCount).toBe(2)
  solver.state.ripCount = 22
  const oldSegments = solver.state.regionSegments
  const oldCaches = solver.state.regionIntersectionCaches
  const oldAssignments = solver.state.portAssignment
  solver.resetRoutingStateForRerip()
  oldSegments[0]!.length = 0
  oldCaches[0]!.netIds.fill(99)
  oldAssignments.fill(-1)
  solver.state.ripCount = 32
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(observations).toHaveLength(1)
  expect(observations[0]!.attempt).toBe(0)
  expect(observations[0]!.remainingRouteIds).toEqual([2, 4])
  expect(observations[0]!.segments).toEqual([[[0, 0, 1], [1, 2, 3]]])
  expect(observations[0]!.cacheSegmentCount).toBe(2)
  expect(observations[0]!.portAssignment).toEqual([0, 0, 1, 1, -1, -1, -1, -1, -1])
  expect(observations[0]!.maximumIterations).toBe(50_000)
  expect(solver.MAX_ITERATIONS).toBe(2_000_000)
  expect(solver.stats.retainedPartialLiveRipCount).toBe(32)
  expect(solver.stats.retainedPartialRouteCount).toBe(3)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(initialAssignments).toEqual(originalAssignments)
  for (let port = 0; port < solver.topology.portCount; port++) {
    const assigned = solver.state.portAssignment[port]!
    expect(assigned === -1 || assigned === solver.problem.portNetId![port]).toBe(true)
  }
})
