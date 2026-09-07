import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

test("commits a cleared blocker path while preserving unrelated routes", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 9,
    regionCount: 10,
    regionIncidentPorts: [
      [0, 2, 3, 7],
      [1, 2, 4, 8],
      [5, 6],
      [],
      [],
      [],
      [],
      [],
      [],
      [7, 8],
    ],
    incidentPortRegion: [
      [0, 3],
      [1, 4],
      [0, 1],
      [0, 5],
      [1, 6],
      [2, 7],
      [2, 8],
      [0, 9],
      [9, 1],
    ],
    regionWidth: new Float64Array(10).fill(10),
    regionHeight: new Float64Array(10).fill(10),
    regionCenterX: new Float64Array(10),
    regionCenterY: new Float64Array(10),
    portAngleForRegion1: new Int32Array(9),
    portAngleForRegion2: new Int32Array(9),
    portX: new Float64Array([-2, 2, 0, -2, 2, -2, 2, -1, 1]),
    portY: new Float64Array([0, 0, 0, 1, 1, 5, 5, -2, -2]),
    portZ: new Int32Array(9),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(9).fill(1),
    routeStartPort: new Int32Array([0, 3, 5]),
    routeEndPort: new Int32Array([1, 4, 6]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([-1, -1, -1, -1, -1, -1, -1, -1, -1, 0]),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
      { routeId: 0, regionId: 1, fromPortId: 2, toPortId: 1 },
      { routeId: 2, regionId: 2, fromPortId: 5, toPortId: 6 },
    ],
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.state.currentRouteId = 1
  solver.state.currentRouteNetId = 1
  solver.state.goalPortId = 4

  solver.onOutOfCandidates()

  expect(solver.state.regionSegments[0]).toEqual([[1, 3, 2]])
  expect(solver.state.regionSegments[1]).toEqual([[1, 2, 4]])
  expect(solver.state.regionSegments[2]).toEqual([[2, 5, 6]])
  expect(solver.state.unroutedRoutes).toEqual([0])
  expect(solver.state.currentRouteId).toBeUndefined()
  expect(solver.state.portAssignment[2]).toBe(1)
  expect(solver.state.portAssignment[5]).toBe(2)
  expect(solver.state.regionCongestionCost[0]).toBeGreaterThan(0)
  expect(solver.state.regionCongestionCost[1]).toBeGreaterThan(0)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.regionSegments[2]).toEqual([[2, 5, 6]])
  expect(solver.state.portAssignment[2]).toBe(1)
  expect(solver.state.portAssignment[7]).toBe(0)
  expect(solver.state.portAssignment[8]).toBe(0)
})
