type LesserAngle = number
type Z1 = number
type GreaterAngle = number
type Z2 = number
type SameLayerIntersectionCount = number
type CrossingLayerIntersectionCount = number
type EntryExitLayerChanges = number

export const countIntersectionsFromAnglePairsDynamic = (
  anglePairs: Array<[LesserAngle, Z1, GreaterAngle, Z2]>,
): [
  SameLayerIntersectionCount,
  CrossingLayerIntersectionCount,
  EntryExitLayerChanges,
] => {
  let crossingLayerIntersectionCount = 0
  let sameLayerIntersectionCount = 0

  for (let i = 0; i < anglePairs.length; i++) {
    const [a, az, b, bz] = anglePairs[i]
    for (let u = i + 1; u < anglePairs.length; u++) {
      const [c, cz, d, dz] = anglePairs[u]
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
    const [, z1, , z2] = anglePairs[i]
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
