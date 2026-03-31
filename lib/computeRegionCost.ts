const viaSize = 0.45
const viaSizeSq = viaSize ** 2
const traceWidth = 0.1
const IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST = 10

const isKnownSingleLayerMask = (regionAvailableZMask: number) =>
  regionAvailableZMask === 1 || regionAvailableZMask === 2

export const computeRegionCost = (
  regionWidth: number,
  regionHeight: number,
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
  traceCount: number,
  regionAvailableZMask = 0,
) => {
  const area = regionWidth * regionHeight

  const estViasRequired =
    numSameLayerIntersections * 2 +
    numCrossLayerIntersections * 1 +
    numEntryExitChanges * 1

  const traceCountMult = 1 + traceCount / 5
  const impossibleSingleLayerIntersectionCost = isKnownSingleLayerMask(
    regionAvailableZMask,
  )
    ? numSameLayerIntersections * IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST
    : 0

  return (
    (estViasRequired * viaSizeSq * traceCountMult) / area +
    impossibleSingleLayerIntersectionCost
  )
}
