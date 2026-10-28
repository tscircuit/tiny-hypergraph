import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { TinyHyperGraphSectionSolver } from "../../lib/section-solver"
import { createNativePermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("mutable seed occupancy clears on core rerip while physical permissions survive reset and replay", () => {
  const assignments = [
    { routeId: 0, regionId: 1, fromPortId: 0, toPortId: 1 },
    { routeId: 0, regionId: 2, fromPortId: 1, toPortId: 3 },
  ]
  const allowed = createNativePermissionFixture()
  allowed.problem.initialAssignments = assignments
  const solver = new TinyHyperGraphSolver(allowed.topology, allowed.problem, permissionSolveOptions)
  expect([...solver.state.portAssignment]).toEqual([0, 0, -1, 0])
  expect(solver.state.unroutedRoutes).toEqual([])
  solver.resetRoutingStateForRerip()
  expect([...solver.state.portAssignment]).toEqual([-1, -1, -1, -1])
  expect(solver.state.unroutedRoutes).toEqual([0])
  solver.state.currentRouteNetId = 2
  expect(solver.isPortReservedForDifferentNet(1)).toBe(true)
  solver.state.currentRouteNetId = 0
  expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
  solver.state.currentRouteNetId = undefined
  solver.solve()
  expect(solver.solved).toBe(true)

  const secondOwner = createNativePermissionFixture(1)
  secondOwner.problem.portNetId![1] = 1
  secondOwner.problem.initialAssignments = assignments
  solver.resetForProblem(secondOwner.problem)
  expect([...solver.state.portAssignment]).toEqual([1, 1, -1, 1])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const prepared = new PreparedPortPointRoutingSolver(allowed.topology, allowed.problem, permissionSolveOptions)
  prepared.resetRoutingStateForRerip()
  expect([...prepared.state.portAssignment]).toEqual([0, 0, -1, 0])
  expect(prepared.state.unroutedRoutes).toEqual([])
  prepared.solve()
  expect(prepared.solved).toBe(true)
  const replay = new TinyHyperGraphSectionSolver(
    allowed.topology,
    allowed.problem,
    { solvedRoutePathSegments: [[[0, 1], [1, 3]]], solvedRoutePathRegionIds: [[1, 2]] },
  )
  expect(replay.baselineSolver.state.portAssignment[1]).toBe(0)
  replay.solve()
  expect(replay.solved).toBe(true)

  const foreign = createNativePermissionFixture(2)
  foreign.problem.initialAssignments = assignments
  expect(() => new TinyHyperGraphSolver(foreign.topology, foreign.problem, permissionSolveOptions)).toThrow("does not allow")
  expect(() => new PreparedPortPointRoutingSolver(foreign.topology, foreign.problem, permissionSolveOptions)).toThrow("does not allow")
  expect(() => solver.resetForProblem(foreign.problem)).toThrow("does not allow")
  delete foreign.problem.initialAssignments
  expect(() => new TinyHyperGraphSectionSolver(
    foreign.topology,
    foreign.problem,
    { solvedRoutePathSegments: [[[0, 1], [1, 3]]], solvedRoutePathRegionIds: [[1, 2]] },
  )).toThrow("does not allow")
})
