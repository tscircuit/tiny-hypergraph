import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

test("resumed port distances preserve the occupancy snapshot and route penalties", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 6,
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [1, 4], [4, 3], [5]],
    incidentPortRegion: [[0], [0, 1, 3], [1, 2], [2, 4], [3, 4], [5]],
    regionWidth: new Float64Array(6).fill(10),
    regionHeight: new Float64Array(6).fill(10),
    regionCenterX: new Float64Array(6),
    regionCenterY: new Float64Array(6),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 1, 2, 3, 2, 4]),
    portY: new Float64Array(6),
    portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([3]),
    routeEndPort: new Int32Array([0]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(6).fill(-1),
    portPenalty: new Float64Array([0, 0, 0, 0, 7, 0]),
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 1,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0

  expect(solver.computeH(0)).toBe(0)
  // A later committed route removes an edge. The cached distances remain
  // lower bounds on the original graph until a rip invalidates them.
  solver.state.portAssignment[2] = 1
  expect(solver.computeH(3)).toBe(3)
  expect(solver.computeH(1)).toBe(1)
  expect(solver.computeH(4)).toBe(2)
  expect(solver.computeH(5)).toBe(Number.POSITIVE_INFINITY)

  solver.resetRoutingStateForRerip()
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.portAssignment[2] = 1

  expect(solver.computeH(1)).toBe(1)
  expect(solver.computeH(3)).toBe(10)
  expect(solver.computeH(2)).toBe(Number.POSITIVE_INFINITY)
})
