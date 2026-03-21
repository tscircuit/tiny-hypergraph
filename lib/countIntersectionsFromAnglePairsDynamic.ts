import type {
  CrossingLayerIntersectionCount,
  DynamicAnglePair,
  EntryExitLayerChanges,
  SameLayerIntersectionCount,
} from "./types"

export const countIntersectionsFromAnglePairsDynamic = (
  anglePairs: Array<DynamicAnglePair>,
): [
  SameLayerIntersectionCount,
  CrossingLayerIntersectionCount,
  EntryExitLayerChanges,
] => {
  let crossingLayerIntersectionCount = 0
  let sameLayerIntersectionCount = 0

  for (let i = 0; i < anglePairs.length; i++) {
    const [n1, a, az, b, bz] = anglePairs[i]
    for (let u = i + 1; u < anglePairs.length; u++) {
      const [n2, c, cz, d, dz] = anglePairs[u]
      if (n1 === n2) continue
      const intersects = (a < c && c < b) !== (a < d && d < b) ? 1 : 0
      if (az === cz || bz === cz || az === dz || bz === dz) {
        sameLayerIntersectionCount += intersects
      } else {
        crossingLayerIntersectionCount += intersects
      }
    }
  }

  let entryExitChanges = 0
  for (let i = 0; i < anglePairs.length; i++) {
    const [, , z1, , z2] = anglePairs[i]
    if (z1 !== z2) {
      entryExitChanges++
    }
  }

  return [
    sameLayerIntersectionCount,
    crossingLayerIntersectionCount,
    entryExitChanges,
  ]
}
