import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../../lib/core"

/** Fixed boundary ports: a retained west-east net leaves a legal outer detour for a north-south net. */
export const createSingleLayerCompletionFixture = (
  mask = 1,
  directGoal = false,
  allowedViaOwners?: ReadonlySet<number>,
): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } => ({
  topology: {
    portCount: 8, regionCount: 8,
    regionIncidentPorts: [[0, 1, 2, 3], [2, 4, 6], [4, 5], [3, 5, 7], [0], [1], [6], [7]],
    incidentPortRegion: [[4, 0], [0, 5], [1, 0], [0, 3], [1, 2], [2, 3], [6, 1], [3, 7]],
    regionWidth: new Float64Array(8).fill(2),
    regionHeight: new Float64Array(8).fill(2),
    regionCenterX: Float64Array.of(0, 1, 2, 1, -2, 2, 0, 0),
    regionCenterY: Float64Array.of(0, 1, 0, -1, 0, 0, 3, -3),
    regionAvailableZMask: Int32Array.of(mask, ...new Array<number>(7).fill(mask === 3 ? 1 : mask)),
    portAngleForRegion1: Int32Array.of(0, 0, 27000, 27000, 0, 27000, 27000, 27000),
    portAngleForRegion2: Int32Array.of(18000, 18000, 9000, 18000, 9000, 0, 18000, 9000),
    portX: Float64Array.of(-1, 1, 0, 0, 2, 2, 0, 0),
    portY: Float64Array.of(0, 0, 1, -1, 1, -1, 2, -2),
    portZ: new Int32Array(8).fill(Math.log2(mask & -mask)),
  },
  problem: {
    routeCount: 2, portSectionMask: new Int8Array(8).fill(1),
    routeStartPort: Int32Array.of(0, 6), routeEndPort: Int32Array.of(1, directGoal ? 3 : 7),
    routeNet: Int32Array.of(0, 1), regionNetId: Int32Array.of(-1, -1, -1, -1, 0, 0, 1, 1),
    ...(allowedViaOwners === undefined ? {} : { regionLayerChangeAllowedNetIds: [allowedViaOwners, ...new Array<undefined>(7).fill(undefined)] }),
    initialAssignments: [{ routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 }],
  },
})
