export type PortId = number
export type RegionId = number
export type Integer = number
export type RouteId = number
export type NetId = number
export type HopId = number

/** SegmentIds are computed via port1Id * portCount + port2Id */
export type SegmentId = number

/** A lossy hash on a segment id, can be used for congestion where an erroneous collision is not too bad */
export type LossySegmentIdHash = number

export type LesserAngle = number
export type Z1 = number
export type GreaterAngle = number
export type Z2 = number

export type DynamicAnglePair = [NetId, LesserAngle, Z1, GreaterAngle, Z2]
export interface DynamicAnglePairArrays {
  netIds: Int32Array
  lesserAngles: Int32Array
  greaterAngles: Int32Array
  layerMasks: Int32Array
}

export interface RegionIntersectionCache extends DynamicAnglePairArrays {
  port1Ids?: Int32Array
  port2Ids?: Int32Array
  x1?: Float64Array
  y1?: Float64Array
  x2?: Float64Array
  y2?: Float64Array
  existingSameLayerIntersections: Integer
  existingCrossingLayerIntersections: Integer
  existingEntryExitLayerChanges: Integer
  existingRegionCost: number
  existingSegmentCount: number
}

export type SameLayerIntersectionCount = number
export type CrossingLayerIntersectionCount = number
export type EntryExitLayerChanges = number
