const viaSize = 0.45
const viaSizeSq = viaSize ** 2
const traceWidth = 0.1

export const computeRegionCost = (
  regionWidth: number,
  regionHeight: number,
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
  traceCount: number,
) => {
  const area = regionWidth * regionHeight

  const estViasRequired =
    numSameLayerIntersections * 2 +
    numCrossLayerIntersections * 1 +
    numEntryExitChanges * 1

  const traceCountMult = 1 + traceCount / 5

  return (estViasRequired * viaSizeSq * traceCountMult) / area
}
