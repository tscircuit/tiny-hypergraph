export type PortId = number
export type RegionId = number
export type Integer = number
export type RouteId = number
export type NetId = number

/** SegmentIds are computed via port1Id * portCount + port2Id */
export type SegmentId = number

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
  existingSameLayerIntersections: Integer
  existingCrossingLayerIntersections: Integer
  existingEntryExitLayerChanges: Integer
  existingRegionCost: number
}

export type SameLayerIntersectionCount = number
export type CrossingLayerIntersectionCount = number
export type EntryExitLayerChanges = number
