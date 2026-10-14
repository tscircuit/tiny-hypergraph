import type { TinyHyperGraphTopology, TinyHyperGraphProblem } from "../core"

type NumericArray = Float64Array | Int32Array | Int8Array
function share<T extends NumericArray>(values: T): T {
  const Constructor = values.constructor as {
    new (buffer: SharedArrayBuffer): T
  }
  const result = new Constructor(new SharedArrayBuffer(values.byteLength))
  result.set(values)
  return result
}
function packRows(rows: number[][]) {
  const offsets = new Int32Array(new SharedArrayBuffer((rows.length + 1) * 4))
  const values = new Int32Array(
    new SharedArrayBuffer(rows.reduce((n, r) => n + r.length, 0) * 4),
  )
  let cursor = 0
  for (let r = 0; r < rows.length; r++) {
    offsets[r] = cursor
    values.set(rows[r], cursor)
    cursor += rows[r].length
  }
  offsets[rows.length] = cursor
  return { offsets, values }
}
function unpackRows(rows: { offsets: Int32Array; values: Int32Array }) {
  return Array.from({ length: rows.offsets.length - 1 }, (_, r) =>
    Array.from(rows.values.subarray(rows.offsets[r], rows.offsets[r + 1])),
  )
}
export interface PackedPortfolioInput {
  topology: Omit<
    TinyHyperGraphTopology,
    | "regionIncidentPorts"
    | "incidentPortRegion"
    | "regionMetadata"
    | "portMetadata"
  >
  problem: TinyHyperGraphProblem
  regionPorts: { offsets: Int32Array; values: Int32Array }
  portRegions: { offsets: Int32Array; values: Int32Array }
}
/** Share immutable numeric inputs once. Reconstruct adjacency locally rather
 * than synchronously cloning tens of thousands of arrays and display objects
 * on the coordinator for every worker. */
export function packPortfolioInput(
  t: TinyHyperGraphTopology,
  p: TinyHyperGraphProblem,
): PackedPortfolioInput {
  return {
    topology: {
      portCount: t.portCount,
      regionCount: t.regionCount,
      regionWidth: share(t.regionWidth),
      regionHeight: share(t.regionHeight),
      regionCenterX: share(t.regionCenterX),
      regionCenterY: share(t.regionCenterY),
      ...(t.regionAvailableZMask
        ? { regionAvailableZMask: share(t.regionAvailableZMask) }
        : {}),
      portAngleForRegion1: share(t.portAngleForRegion1),
      ...(t.portAngleForRegion2
        ? { portAngleForRegion2: share(t.portAngleForRegion2) }
        : {}),
      portX: share(t.portX),
      portY: share(t.portY),
      portZ: share(t.portZ),
    },
    problem: {
      ...p,
      portSectionMask: share(p.portSectionMask),
      routeStartPort: share(p.routeStartPort),
      routeEndPort: share(p.routeEndPort),
      routeNet: share(p.routeNet),
      regionNetId: share(p.regionNetId),
      ...(p.portPenalty ? { portPenalty: share(p.portPenalty) } : {}),
    },
    regionPorts: packRows(t.regionIncidentPorts),
    portRegions: packRows(t.incidentPortRegion),
  }
}
export function unpackPortfolioInput(input: PackedPortfolioInput): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} {
  return {
    topology: {
      ...input.topology,
      regionIncidentPorts: unpackRows(input.regionPorts),
      incidentPortRegion: unpackRows(input.portRegions),
    },
    problem: input.problem,
  }
}
