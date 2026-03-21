import type {
  CrossingLayerIntersectionCount,
  DynamicAnglePair,
  EntryExitLayerChanges,
  SameLayerIntersectionCount,
} from "./types"

export const countNewIntersections = (
  existingPairs: Int32Array, // [NetId, LesserAngle, Z1, GreaterAngle, Z2] * existing pair count
  newPair: DynamicAnglePair,
): [
  SameLayerIntersectionCount,
  CrossingLayerIntersectionCount,
  EntryExitLayerChanges,
] => {
  const [newNet, newLesserAngle, newZ1, newGreaterAngle, newZ2] = newPair

  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0
  const entryExitLayerChanges = newZ1 !== newZ2 ? 1 : 0

  for (let i = 0; i < existingPairs.length; i += 5) {
    const [
      existingNet,
      existingLesserAngle,
      existingZ1,
      existingGreaterAngle,
      existingZ2,
    ] = [
      existingPairs[i],
      existingPairs[i + 1],
      existingPairs[i + 2],
      existingPairs[i + 3],
      existingPairs[i + 4],
    ]

    if (newNet === existingNet) continue

    const intersects =
      (newLesserAngle < existingLesserAngle &&
        existingLesserAngle < newGreaterAngle) !==
      (newLesserAngle < existingGreaterAngle &&
        existingGreaterAngle < newGreaterAngle)
        ? 1
        : 0

    if (intersects === 0) continue

    if (
      newZ1 === existingZ1 ||
      newZ2 === existingZ1 ||
      newZ1 === existingZ2 ||
      newZ2 === existingZ2
    ) {
      sameLayerIntersectionCount += intersects
    } else {
      crossingLayerIntersectionCount += intersects
    }
  }

  return [
    sameLayerIntersectionCount,
    crossingLayerIntersectionCount,
    entryExitLayerChanges,
  ]
}

export const countIntersectionsFromAnglePairsDynamic = countNewIntersections
