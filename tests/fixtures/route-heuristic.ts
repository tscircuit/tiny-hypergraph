import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"

export const createRouteHeuristicFixture = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => ({
  topology: {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: new Float64Array([20]),
    regionHeight: new Float64Array([20]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(4),
    portX: new Float64Array([-3.5, 0.25, 2, 4.5]),
    portY: new Float64Array([1.25, -2, 0, 3]),
    portZ: new Int32Array(4),
  },
  problem: {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 3]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1]),
  },
})
