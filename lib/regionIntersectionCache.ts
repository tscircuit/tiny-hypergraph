import type { RegionIntersectionCache } from "./types"

const EMPTY_REGION_INTERSECTION_VALUES = new Int32Array(0)

const cloneRegionIntersectionValues = (values: Int32Array): Int32Array =>
  values.length === 0
    ? EMPTY_REGION_INTERSECTION_VALUES
    : new Int32Array(values)

export const createEmptyRegionIntersectionCache =
  (): RegionIntersectionCache => ({
    netIds: EMPTY_REGION_INTERSECTION_VALUES,
    lesserAngles: EMPTY_REGION_INTERSECTION_VALUES,
    greaterAngles: EMPTY_REGION_INTERSECTION_VALUES,
    layerMasks: EMPTY_REGION_INTERSECTION_VALUES,
    existingCrossingLayerIntersections: 0,
    existingSameLayerIntersections: 0,
    existingEntryExitLayerChanges: 0,
    existingRegionCost: 0,
    existingSegmentCount: 0,
  })

export const cloneRegionIntersectionCache = (
  regionIntersectionCache: RegionIntersectionCache,
): RegionIntersectionCache => ({
  netIds: cloneRegionIntersectionValues(regionIntersectionCache.netIds),
  lesserAngles: cloneRegionIntersectionValues(
    regionIntersectionCache.lesserAngles,
  ),
  greaterAngles: cloneRegionIntersectionValues(
    regionIntersectionCache.greaterAngles,
  ),
  layerMasks: cloneRegionIntersectionValues(regionIntersectionCache.layerMasks),
  existingCrossingLayerIntersections:
    regionIntersectionCache.existingCrossingLayerIntersections,
  existingSameLayerIntersections:
    regionIntersectionCache.existingSameLayerIntersections,
  existingEntryExitLayerChanges:
    regionIntersectionCache.existingEntryExitLayerChanges,
  existingRegionCost: regionIntersectionCache.existingRegionCost,
  existingSegmentCount: regionIntersectionCache.existingSegmentCount,
})
