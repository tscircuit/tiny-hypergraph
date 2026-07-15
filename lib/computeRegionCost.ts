export const DEFAULT_MIN_VIA_PAD_DIAMETER = 0.3
export const TRACE_VIA_MARGIN = 0.15
const traceWidth = 0.1
const IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST = 10

export const isKnownSingleLayerMask = (regionAvailableZMask: number) =>
  regionAvailableZMask > 0 &&
  (regionAvailableZMask & (regionAvailableZMask - 1)) === 0

export const computeEstimatedViaCount = (
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
) =>
  numSameLayerIntersections * 2 +
  numCrossLayerIntersections +
  numEntryExitChanges

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
  const estViasRequired = computeEstimatedViaCount(
    numSameLayerIntersections,
    numCrossLayerIntersections,
    numEntryExitChanges,
  )
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
