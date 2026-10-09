import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/index"

export const negotiatedRegionPathTopology: TinyHyperGraphTopology = {
  portCount: 9,
  regionCount: 9,
  regionIncidentPorts: [
    [0, 5],
    [1],
    [0, 1, 2],
    [2, 3, 4],
    [3, 8],
    [4],
    [5, 6],
    [6, 7],
    [7, 8],
  ],
  incidentPortRegion: [
    [0, 2],
    [1, 2],
    [2, 3],
    [3, 4],
    [3, 5],
    [0, 6],
    [6, 7],
    [7, 8],
    [8, 4],
  ],
  regionWidth: new Float64Array(9).fill(1),
  regionHeight: new Float64Array(9).fill(1),
  regionCenterX: new Float64Array([0, 0, 2, 4, 6, 6, 1, 3, 5]),
  regionCenterY: new Float64Array([1, -1, 0, 0, 1, -1, 3, 3, 3]),
  regionMetadata: [
    { serializedRegionId: "flexible-start" },
    { serializedRegionId: "constrained-start" },
    { serializedRegionId: "shared-left" },
    { serializedRegionId: "shared-right" },
    { serializedRegionId: "flexible-end" },
    { serializedRegionId: "constrained-end" },
    { serializedRegionId: "detour-left" },
    { serializedRegionId: "detour-center" },
    { serializedRegionId: "detour-right" },
  ],
  portAngleForRegion1: new Int32Array(9),
  portAngleForRegion2: new Int32Array(9),
  portX: new Float64Array([1, 1, 3, 5, 5, 0.5, 2, 4, 5.5]),
  portY: new Float64Array([0.5, -0.5, 0, 0.5, -0.5, 2, 3, 3, 2]),
  portZ: new Int32Array(9),
}

export const negotiatedRegionPathProblem: TinyHyperGraphProblem = {
  routeCount: 2,
  portSectionMask: new Int8Array(9).fill(1),
  routeMetadata: [
    {
      connectionId: "flexible-net",
      startRegionId: "flexible-start",
      endRegionId: "flexible-end",
    },
    {
      connectionId: "constrained-net",
      startRegionId: "constrained-start",
      endRegionId: "constrained-end",
    },
  ],
  routeStartPort: new Int32Array([0, 1]),
  routeEndPort: new Int32Array([3, 4]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array([0, 1, -1, -1, 0, 1, -1, -1, -1]),
}
