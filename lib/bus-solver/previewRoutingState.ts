import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphWorkingState,
} from "../core"
import type { PortId, RouteId } from "../types"
import type { PreviewRoutingStateSnapshot } from "./busSolverTypes"

export const clearPreviewRoutingState = (
  state: TinyHyperGraphWorkingState,
  regionCount: number,
) => {
  state.portAssignment.fill(-1)
  state.regionSegments = Array.from({ length: regionCount }, () => [])
  state.regionIntersectionCaches = Array.from({ length: regionCount }, () =>
    createEmptyRegionIntersectionCache(),
  )
  state.regionCongestionCost.fill(0)
  state.ripCount = 0
}

export const getPreviewRegionCost = (state: TinyHyperGraphWorkingState) => {
  let totalCost = 0

  for (const regionCache of state.regionIntersectionCaches) {
    totalCost += regionCache.existingRegionCost
  }

  return totalCost
}

export const getPreviewIntersectionCounts = (
  state: TinyHyperGraphWorkingState,
) => {
  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0

  for (const regionCache of state.regionIntersectionCaches) {
    sameLayerIntersectionCount += regionCache.existingSameLayerIntersections
    crossingLayerIntersectionCount +=
      regionCache.existingCrossingLayerIntersections
  }

  return {
    sameLayerIntersectionCount,
    crossingLayerIntersectionCount,
  }
}

export const snapshotPreviewRoutingState = (
  state: TinyHyperGraphWorkingState,
): PreviewRoutingStateSnapshot => ({
  portAssignment: new Int32Array(state.portAssignment),
  regionSegments: state.regionSegments.map((segments) =>
    segments.map((segment) => [...segment] as [RouteId, PortId, PortId]),
  ),
  regionIntersectionCaches: state.regionIntersectionCaches.map((cache) => ({
    netIds: new Int32Array(cache.netIds),
    lesserAngles: new Int32Array(cache.lesserAngles),
    greaterAngles: new Int32Array(cache.greaterAngles),
    layerMasks: new Int32Array(cache.layerMasks),
    existingCrossingLayerIntersections:
      cache.existingCrossingLayerIntersections,
    existingSameLayerIntersections: cache.existingSameLayerIntersections,
    existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
    existingRegionCost: cache.existingRegionCost,
    existingSegmentCount: cache.existingSegmentCount,
  })),
})

export const restorePreviewRoutingState = (
  state: TinyHyperGraphWorkingState,
  snapshot: PreviewRoutingStateSnapshot,
) => {
  state.portAssignment = new Int32Array(snapshot.portAssignment)
  state.regionSegments = snapshot.regionSegments.map((segments) =>
    segments.map((segment) => [...segment] as [RouteId, PortId, PortId]),
  )
  state.regionIntersectionCaches = snapshot.regionIntersectionCaches.map(
    (cache) => ({
      netIds: new Int32Array(cache.netIds),
      lesserAngles: new Int32Array(cache.lesserAngles),
      greaterAngles: new Int32Array(cache.greaterAngles),
      layerMasks: new Int32Array(cache.layerMasks),
      existingCrossingLayerIntersections:
        cache.existingCrossingLayerIntersections,
      existingSameLayerIntersections: cache.existingSameLayerIntersections,
      existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
      existingRegionCost: cache.existingRegionCost,
      existingSegmentCount: cache.existingSegmentCount,
    }),
  )
}
