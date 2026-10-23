import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphSolverOptions,
} from "../../lib/core"

export const createPortfolioInput = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
} => ({
  topology: {
    portCount: 6,
    regionCount: 6,
    regionIncidentPorts: [[0, 1, 3, 4], [1, 2, 4, 5], [0], [2], [3], [5]],
    incidentPortRegion: [
      [0, 2],
      [0, 1],
      [1, 3],
      [0, 4],
      [0, 1],
      [1, 5],
    ],
    regionWidth: new Float64Array(6).fill(20),
    regionHeight: new Float64Array(6).fill(20),
    regionCenterX: Float64Array.from([0, 10, -10, 20, -10, 20]),
    regionCenterY: new Float64Array(6),
    regionAvailableZMask: new Int32Array(6).fill(3),
    portX: Float64Array.from([-5, 5, 15, -5, 5, 15]),
    portY: Float64Array.from([0, 0, 0, 3, 3, 3]),
    portZ: new Int32Array(6),
    portAngleForRegion1: Int32Array.from([18000, 0, 0, 16000, 2000, 2000]),
    portAngleForRegion2: Int32Array.from([18000, 18000, 0, 16000, 16000, 2000]),
  },
  problem: {
    routeCount: 2,
    routeNet: Int32Array.from([11, 22]),
    routeStartPort: Int32Array.from([0, 3]),
    routeEndPort: Int32Array.from([2, 5]),
    portSectionMask: new Int8Array(6).fill(1),
    regionNetId: new Int32Array(6).fill(-1),
    initialAssignments: [
      { routeId: 1, regionId: 0, fromPortId: 3, toPortId: 4 },
      { routeId: 1, regionId: 1, fromPortId: 4, toPortId: 5 },
    ],
  },
  options: {
    MAX_ITERATIONS: 200,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    GREEDY_FINAL_ROUTE_ITERS: 0,
  },
})
