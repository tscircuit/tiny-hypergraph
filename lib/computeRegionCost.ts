export const DEFAULT_MIN_VIA_PAD_DIAMETER = 0.3
export const TRACE_VIA_MARGIN = 0.15
const traceWidth = 0.1
const routedTraceWidth = 0.15
export const IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST = 10

export const isKnownSingleLayerMask = (regionAvailableZMask: number) =>
  regionAvailableZMask > 0 &&
  (regionAvailableZMask & (regionAvailableZMask - 1)) === 0

export interface PreparedRoutingRiskRegionCapacity {
  isKnownSingleLayer: boolean
  totalCapacity: number
  traceOccupancyPerTrace: number
}

export const prepareRoutingRiskRegionCapacity = (
  regionWidth: number,
  regionHeight: number,
  regionAvailableZMask = 0,
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER,
): PreparedRoutingRiskRegionCapacity => {
  const isKnownSingleLayer = isKnownSingleLayerMask(regionAvailableZMask)
  const width = Number(regionWidth)
  const height = Number(regionHeight)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return {
      isKnownSingleLayer,
      totalCapacity: 0,
      traceOccupancyPerTrace: Number.POSITIVE_INFINITY,
    }
  }

  const obstacleMargin = 0.2
  const minimumSide = Math.min(width, height)
  const effectiveSpan = Math.sqrt(width * height)
  const narrowSideViaRatio = minimumSide / (minViaPadDiameter + obstacleMargin)
  const viaRatioFactor = Math.min(
    1.2,
    Math.max(0.85, narrowSideViaRatio ** 0.05),
  )
  const viaLengthAcross =
    (effectiveSpan * viaRatioFactor) / (minViaPadDiameter / 2 + obstacleMargin)
  let totalCapacity = (viaLengthAcross / 2) ** 1.1
  if (isKnownSingleLayer && totalCapacity > 1) totalCapacity = 1
  if (!Number.isFinite(totalCapacity) || totalCapacity <= 0) totalCapacity = 0

  return {
    isKnownSingleLayer,
    totalCapacity,
    traceOccupancyPerTrace:
      routedTraceWidth /
      (effectiveSpan * countAvailableLayers(regionAvailableZMask)),
  }
}

export const computeRoutingRiskRegionCostWithPreparedCapacity = (
  capacity: PreparedRoutingRiskRegionCapacity,
  numSameLayerIntersections: number,
  numTransitionPairIntersections: number,
  numEntryExitChanges: number,
  traceCount = 0,
): number => {
  if (
    capacity.isKnownSingleLayer &&
    (numSameLayerIntersections > 0 ||
      numTransitionPairIntersections > 0 ||
      numEntryExitChanges > 0)
  ) {
    return 1
  }

  const estimatedViaCount =
    numSameLayerIntersections * 0.82 +
    numEntryExitChanges * 0.41 +
    numTransitionPairIntersections * 0.2
  const estimatedUsedCapacity = (estimatedViaCount / 2) ** 1.1
  if (!Number.isFinite(estimatedUsedCapacity)) {
    return estimatedViaCount > 0 ? 1 : 0
  }
  if (capacity.totalCapacity <= 0) {
    return estimatedUsedCapacity > 0 ? 1 : 0
  }

  const remainingCapacityFraction =
    1 - Math.max(0, traceCount) * capacity.traceOccupancyPerTrace
  if (
    !Number.isFinite(remainingCapacityFraction) ||
    remainingCapacityFraction <= 0
  ) {
    return estimatedUsedCapacity > 0 ? 1 : 0
  }

  return (
    estimatedUsedCapacity / capacity.totalCapacity / remainingCapacityFraction
  )
}

export const computeRegionCost = (
  regionWidth: number,
  regionHeight: number,
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
  traceCount: number,
  regionAvailableZMask = 0,
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER,
  traceDensityCostFactor = 0,
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
    traceDensityCostFactor,
  )
}

/**
 * Region failure estimate used by the downstream high-density router. Unlike
 * the legacy area proxy, this preserves the relative via weights and tuned
 * capacity curve used when deciding which capacity nodes are hardest to
 * realize physically.
 */
export const computeRoutingRiskRegionCost = (
  regionWidth: number,
  regionHeight: number,
  numSameLayerIntersections: number,
  numTransitionPairIntersections: number,
  numEntryExitChanges: number,
  regionAvailableZMask = 0,
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER,
  traceCount = 0,
): number => {
  return computeRoutingRiskRegionCostWithPreparedCapacity(
    prepareRoutingRiskRegionCapacity(
      regionWidth,
      regionHeight,
      regionAvailableZMask,
      minViaPadDiameter,
    ),
    numSameLayerIntersections,
    numTransitionPairIntersections,
    numEntryExitChanges,
    traceCount,
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
  traceDensityCostFactor = 0,
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
  const layerCount = countAvailableLayers(regionAvailableZMask)
  const traceDensityCost =
    (traceDensityCostFactor *
      (traceCount / layerCount) ** 2 *
      traceWidth ** 2) /
    area
  const intersectionCost =
    (estViasRequired * viaSizeWithMarginSq * traceCountMult) / area

  return (
    Math.max(intersectionCost, traceDensityCost) +
    impossibleSingleLayerIntersectionCost
  )
}

const countAvailableLayers = (regionAvailableZMask: number) => {
  if (regionAvailableZMask === 0) return 2

  let mask = regionAvailableZMask >>> 0
  let count = 0
  while (mask !== 0) {
    count += mask & 1
    mask >>>= 1
  }
  return count
}
