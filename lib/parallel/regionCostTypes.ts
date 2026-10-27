import type { RegionIntersectionCache } from "../types"

export const COST_SLOT_COUNT = 16
// Each slot owns a cache line. Status: 0 free, 3 host writing, 1 ready,
// 2 worker computing. Remaining words hold region, net, segment count, version.
export const COST_SLOT_STRIDE = 16
export const COST_SEGMENT_CAPACITY = 2048
export interface RegionCostWorkerInput {
  portMasks: Uint8Array
  maxPorts: number
  // Header: stop, wake generation, started workers, completed tables.
  control: Int32Array
  resultVersions: Int32Array
  slotCounts: Float64Array
  slotSegments: Int32Array
  scores: Float64Array
  pairOffsets: Float64Array
  portOffsets: Int32Array
  angles: Int32Array
  layers: Int32Array
  areas: Float64Array
  layerMasks: Int32Array
  minViaPadDiameter: number
  traceDensityCostFactor: number
}
export interface RegionCostEntry {
  cache: RegionIntersectionCache
  netId: number | null
  activeNetId: number
  version: number
  ready: boolean
}
