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
    numSameLayerIntersections * 0.8 +
    numCrossLayerIntersections * 0.4 +
    numEntryExitChanges * 0.3

  return (estViasRequired * viaSizeSq) / area
}
