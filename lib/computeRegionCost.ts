export const DEFAULT_MIN_VIA_PAD_DIAMETER = 0.3
export const DEFAULT_MIN_TRACE_WIDTH = 0.1
export const DEFAULT_MIN_TRACE_CLEARANCE = 0.1
export const TRACE_VIA_MARGIN = 0.15
const traceWidth = 0.1
const IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST = 10

/**
 * Estimates per-layer copper occupancy as swept trace area divided by region
 * area. This cost is used only by post-solution optimization, where a complete
 * baseline can always be restored, so utilization can remain physically
 * meaningful without weakening initial-route completeness.
 */
export const computeTraceOccupancyCost = (
  regionArea: number,
  traceLengthByLayer: ArrayLike<number>,
  longestTraceLengthByLayer: ArrayLike<number>,
  minTraceWidth = DEFAULT_MIN_TRACE_WIDTH,
  minTraceClearance = DEFAULT_MIN_TRACE_CLEARANCE,
): number => {
  let maxSharedTraceLength = 0
  for (let layerId = 0; layerId < traceLengthByLayer.length; layerId++) {
    const sharedTraceLength = Math.max(
      0,
      (traceLengthByLayer[layerId] ?? 0) -
        (longestTraceLengthByLayer[layerId] ?? 0),
    )
    maxSharedTraceLength = Math.max(maxSharedTraceLength, sharedTraceLength)
  }

  const tracePitch = minTraceWidth + minTraceClearance
  const sharedTraceArea = maxSharedTraceLength * tracePitch
  return (sharedTraceArea / regionArea) ** 2
}

export const isKnownSingleLayerMask = (regionAvailableZMask: number) =>
  regionAvailableZMask > 0 &&
  (regionAvailableZMask & (regionAvailableZMask - 1)) === 0

export const computeRegionCost = (
  regionWidth: number,
  regionHeight: number,
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
  traceCount: number,
  regionAvailableZMask = 0,
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER,
) => {
  const area = regionWidth * regionHeight

  return computeRegionCostForArea(
    area,
    numSameLayerIntersections,
    numCrossLayerIntersections,
    numEntryExitChanges,
    traceCount,
    regionAvailableZMask,
    minViaPadDiameter,
  )
}

export const computeRegionCostForArea = (
  area: number,
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
  traceCount: number,
  regionAvailableZMask = 0,
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER,
) => {
  const estViasRequired =
    numSameLayerIntersections * 2 +
    numCrossLayerIntersections * 1 +
    numEntryExitChanges * 1
  const viaSizeWithMargin = minViaPadDiameter + TRACE_VIA_MARGIN
  const viaSizeWithMarginSq = viaSizeWithMargin ** 2

  const traceCountMult = 1 + traceCount / 5
  const impossibleSingleLayerIntersectionCost = isKnownSingleLayerMask(
    regionAvailableZMask,
  )
    ? numSameLayerIntersections * IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST
    : 0

  return (
    (estViasRequired * viaSizeWithMarginSq * traceCountMult) / area +
    impossibleSingleLayerIntersectionCost
  )
}
