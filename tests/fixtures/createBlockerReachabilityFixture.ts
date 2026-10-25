import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

export type BlockerReachabilityFixture = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solver: SelectiveReripTinyHyperGraphSolver
}

export function createBlockerReachabilityFixture(): BlockerReachabilityFixture {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 7,
    regionIncidentPorts: [[0, 1, 2, 3], [0], [1, 4], [2], [3, 5], [4], [5]],
    incidentPortRegion: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [2, 5],
      [4, 6],
    ],
    regionWidth: new Float64Array(7).fill(1),
    regionHeight: new Float64Array(7).fill(1),
    regionCenterX: new Float64Array(7),
    regionCenterY: new Float64Array(7),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 1, 2, 3, 1, 3]),
    portY: new Float64Array([0, 0, 0, 0, -1, -1]),
    portZ: new Int32Array([0, 0, 1, 1, 0, 1]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([2, 5]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(7).fill(-1),
    portSectionMask: new Int8Array(6).fill(1),
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  return { topology, problem, solver }
}
