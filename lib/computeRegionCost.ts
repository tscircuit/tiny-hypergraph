export const DEFAULT_MIN_VIA_PAD_DIAMETER = 0.3
export const DEFAULT_MIN_TRACE_WIDTH = 0.1
export const DEFAULT_MIN_TRACE_CLEARANCE = 0.1
export const DEFAULT_TRACE_DENSITY_COST_FACTOR = 1
export const TRACE_VIA_MARGIN = 0.15
const IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST = 10

export const computeTraceDensityCost = (
  shortRegionDimension: number,
  distinctNetCount: number,
  minTraceWidth = DEFAULT_MIN_TRACE_WIDTH,
  minTraceClearance = DEFAULT_MIN_TRACE_CLEARANCE,
  traceDensityCostFactor = DEFAULT_TRACE_DENSITY_COST_FACTOR,
): number => {
  const additionalDistinctNets = Math.max(0, distinctNetCount - 1)
  if (additionalDistinctNets === 0) return 0

  const tracePitch = minTraceWidth + minTraceClearance
  return (
    ((additionalDistinctNets * tracePitch) / shortRegionDimension) ** 2 *
    traceDensityCostFactor
  )
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
