const viaSize = 0.6
const viaSizeSq = viaSize ** 2

export const computeRegionCost = (
  regionWidth: number,
  regionHeight: number,
  numSameLayerIntersections: number,
  numCrossLayerIntersections: number,
  numEntryExitChanges: number,
) => {
  const area = regionWidth * regionHeight

  const estViasRequired =
    numSameLayerIntersections * 2 +
    numCrossLayerIntersections * 1 +
    numEntryExitChanges * 1

  return (estViasRequired * viaSizeSq) / area
}
