import {
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"

export const createConnectedNetTreeFixture = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => ({
  topology: {
    portCount: 5,
    regionCount: 6,
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [0, 4], [3], [4]],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [1, 2],
      [2, 4],
      [3, 5],
    ],
    regionWidth: new Float64Array([10, 10, 10, 10, 10, 10]),
    regionHeight: new Float64Array([10, 10, 10, 10, 10, 10]),
    regionCenterX: new Float64Array(6),
    regionCenterY: new Float64Array(6),
    portAngleForRegion1: new Int32Array([0, 180, 180, 180, 180]),
    portAngleForRegion2: new Int32Array([0, 0, 0, 0, 0]),
    portX: new Float64Array([0, 10, 20, 30, -10]),
    portY: new Float64Array(5),
    portZ: new Int32Array(5),
  },
  problem: {
    routeCount: 2,
    routeStartPort: new Int32Array([3, 0]),
    routeEndPort: new Int32Array([1, 3]),
    routeNet: new Int32Array([7, 7]),
    regionNetId: new Int32Array([-1, -1, -1, -1, -1, -1]),
    portSectionMask: new Int8Array([1, 1, 1, 1, 1]),
    initialAssignments: [
      { routeId: 0, regionId: 2, fromPortId: 3, toPortId: 2 },
      { routeId: 0, regionId: 1, fromPortId: 2, toPortId: 1 },
    ],
  },
})
