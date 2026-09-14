import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

export function createCrossingFinalHopSolver({
  layer,
  crossingKind,
  options,
}: {
  layer: number
  crossingKind: "single_layer" | "same_net" | "multilayer"
  options?: ConstructorParameters<typeof TinyHyperGraphSolver>[2]
}): TinyHyperGraphSolver {
  const layerMask = crossingKind === "multilayer" ? 15 : 1 << layer
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 5,
    regionIncidentPorts: [[0, 1, 2, 3], [0], [1], [2], [3]],
    incidentPortRegion: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
    regionWidth: new Float64Array(5).fill(3),
    regionHeight: new Float64Array(5).fill(3),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    regionAvailableZMask: new Int32Array(5).fill(layerMask),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([1, 0, -1, 0]),
    portY: new Float64Array([0, 1, 0, -1]),
    portZ: new Int32Array(4).fill(layer),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([2, 3]),
    routeNet: new Int32Array([0, crossingKind === "same_net" ? 0 : 1]),
    regionNetId: new Int32Array(5).fill(-1),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
    ],
  }
  return new TinyHyperGraphSolver(topology, problem, {
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 1,
    ...options,
  })
}
