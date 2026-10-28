import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import type { TinyHyperGraphFixedCopperSegment } from "lib/fixedCopperCosts"

export const createFixedCopperTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 4,
  regionIncidentPorts: [[0], [0, 1, 2], [1, 2, 3], [3]],
  incidentPortRegion: [[0, 1], [1, 2], [1, 2], [2, 3]],
  regionWidth: new Float64Array([1, 2, 10, 1]),
  regionHeight: new Float64Array([1, 2, 10, 1]),
  regionCenterX: new Float64Array([-1.5, 0, 1.5, 2.5]),
  regionCenterY: new Float64Array(4),
  regionAvailableZMask: new Int32Array([1, 3, 3, 2]),
  portAngleForRegion1: new Int32Array([0, 0, 0, 0]),
  portAngleForRegion2: new Int32Array([18000, 18000, 18000, 18000]),
  portX: new Float64Array([-1, 1, 1, 2]),
  portY: new Float64Array(4),
  portZ: new Int32Array([0, 0, 1, 1]),
})

export const createFixedCopperSegment = (
  override: Partial<TinyHyperGraphFixedCopperSegment> = {},
): TinyHyperGraphFixedCopperSegment => ({
  netId: 1, x1: 0, y1: -1, x2: 0, y2: 1,
  z: 0, width: 0.1, clearance: 0.1, ...override,
})

export const createFixedCopperProblem = (
  segments?: TinyHyperGraphFixedCopperSegment[],
): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(4).fill(1),
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([3]),
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array([0, -1, -1, 0]),
  ...(segments === undefined ? {} : {
    fixedCopperSegmentsByRegion: [[], segments, [], []],
    fixedCopperTraceWidthByRegion: new Float64Array(4).fill(0.1),
  }),
})
