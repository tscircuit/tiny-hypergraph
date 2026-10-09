import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

test("recomputes the port heuristic when a rip releases a blocked corridor", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 5,
    regionIncidentPorts: [[0, 1], [1, 2], [0, 3], [3, 2], [4]],
    incidentPortRegion: [[0, 2], [0, 1], [1, 3], [2, 3], [4]],
    regionWidth: new Float64Array(5).fill(10),
    regionHeight: new Float64Array(5).fill(10),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    portAngleForRegion1: new Int32Array(5),
    portAngleForRegion2: new Int32Array(5),
    portX: new Float64Array([0, 1, 2, 1, 3]),
    portY: new Float64Array(5),
    portZ: new Int32Array(5),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(5).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([2]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(5).fill(-1),
    portPenalty: new Float64Array([0, 0, 0, 7, 0]),
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 1,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.portAssignment[1] = 1

  expect(solver.computeH(0)).toBe(9)
  expect(solver.computeH(1)).toBe(Number.POSITIVE_INFINITY)

  solver.resetRoutingStateForRerip()
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0

  expect(solver.computeH(0)).toBe(2)
  expect(solver.computeH(1)).toBe(1)
})
