import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"

const branchCount = 24
const portCount = branchCount + 3
const regionCount = branchCount + 4
const branchPortIds = Array.from(
  { length: branchCount },
  (_, index) => index + 3,
)
const branchX = branchPortIds.map((_, index) => 1 + (index * 6) / branchCount)

export const mandatoryPortPenaltyTopology: TinyHyperGraphTopology = {
  portCount,
  regionCount,
  regionIncidentPorts: [
    [0, 1, ...branchPortIds],
    [1, 2],
    [0],
    ...branchPortIds.map((id) => [id]),
    [2],
  ],
  incidentPortRegion: [
    [0, 2],
    [0, 1],
    [1, regionCount - 1],
    ...branchPortIds.map((id) => [0, id]),
  ],
  regionWidth: Float64Array.from([
    8,
    2,
    2,
    ...branchX.map(() => 6 / branchCount),
    2,
  ]),
  regionHeight: Float64Array.from([8, 2, 2, ...branchX.map(() => 1), 2]),
  regionCenterX: Float64Array.from([4, 9, -1, ...branchX, 11]),
  regionCenterY: Float64Array.from([0, 0, 0, ...branchX.map(() => 4.5), 0]),
  regionAvailableZMask: new Int32Array(regionCount).fill(1),
  portAngleForRegion1: Int32Array.from([
    18000,
    0,
    0,
    ...branchX.map((x) => 9000 + Math.round(((8 - x) / 8) * 9000)),
  ]),
  portAngleForRegion2: Int32Array.from([
    0,
    18000,
    18000,
    ...branchX.map(() => 31500),
  ]),
  portX: Float64Array.from([0, 8, 10, ...branchX]),
  portY: Float64Array.from([0, 0, 0, ...branchX.map(() => 4)]),
  portZ: new Int32Array(portCount),
}

export const mandatoryPortPenaltyProblem: TinyHyperGraphProblem = {
  routeCount: 1,
  routeStartPort: Int32Array.from([0]),
  routeEndPort: Int32Array.from([2]),
  routeNet: Int32Array.from([0]),
  portSectionMask: new Int8Array(portCount).fill(1),
  regionNetId: new Int32Array(regionCount).fill(-1),
  portPenalty: Float64Array.from([0, 150, 0, ...branchX.map(() => 0)]),
}
