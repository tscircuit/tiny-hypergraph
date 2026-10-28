import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("resetForProblem clears an earlier partial incumbent and its original owner permissions", () => {
  const { solver: fixture } = createFinalRouteCompletionHarness("none")
  const options = { RETAIN_BEST_PARTIAL_ROUTING: true, STATIC_REACHABILITY_PRECHECK: false,
    MAX_ITERATIONS: 2_000_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0 }
  const reused = new TinyHyperGraphSolver(fixture.topology, fixture.problem, options)
  while (reused.state.unroutedRoutes.includes(1) || reused.state.currentRouteId === 1) reused.step()
  reused.resetRoutingStateForRerip()
  const next = { ...structuredClone(fixture.problem), initialAssignments: [],
    routeNet: Int32Array.from(fixture.problem.routeNet, (owner) => owner + 10),
    portNetId: Int32Array.from(fixture.problem.portNetId!, (owner) => owner + 10) }
  reused.resetForProblem(next)
  const fresh = new TinyHyperGraphSolver(fixture.topology, next, options)
  expect(reused.stats).toEqual({})
  expect(reused.state.unroutedRoutes).toEqual(fresh.state.unroutedRoutes)
  reused.tryFinalAcceptance()
  fresh.tryFinalAcceptance()
  expect(reused.solved).toBe(true)
  expect(reused.state.regionSegments).toEqual(fresh.state.regionSegments)
  expect(reused.state.regionIntersectionCaches).toEqual(fresh.state.regionIntersectionCaches)
  expect(reused.state.portAssignment).toEqual(fresh.state.portAssignment)
  expect(reused.stats).toEqual(fresh.stats)
  expect(reused.stats.retainedPartialRouteCount).toBeUndefined()
  expect([...reused.state.portAssignment].every((owner) => owner === -1 || owner >= 10)).toBe(true)
})
