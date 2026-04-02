import type { DynamicAnglePair, DynamicAnglePairArrays } from "./types"

export const createDynamicAnglePairArrays = (
  anglePairs: Array<DynamicAnglePair>,
): DynamicAnglePairArrays => {
  const netIds = new Int32Array(anglePairs.length)
  const lesserAngles = new Int32Array(anglePairs.length)
  const greaterAngles = new Int32Array(anglePairs.length)
  const layerMasks = new Int32Array(anglePairs.length)

  for (let i = 0; i < anglePairs.length; i++) {
    const [netId, lesserAngle, z1, greaterAngle, z2] = anglePairs[i]
    netIds[i] = netId
    lesserAngles[i] = lesserAngle
    greaterAngles[i] = greaterAngle
    layerMasks[i] = (1 << z1) | (1 << z2)
  }

  return {
    netIds,
    lesserAngles,
    greaterAngles,
    layerMasks,
    pairCount: anglePairs.length,
  }
}

export const countNewIntersectionsWithValues = (
  existingPairs: DynamicAnglePairArrays,
  newNet: number,
  newLesserAngle: number,
  newGreaterAngle: number,
  newLayerMask: number,
  entryExitLayerChanges: number,
): [number, number, number] => {
  const { netIds, lesserAngles, greaterAngles, layerMasks } = existingPairs
  const pairCount = existingPairs.pairCount ?? netIds.length

  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0

  for (let i = 0; i < pairCount; i++) {
    if (newNet === netIds[i]) continue

    const lesserAngleIsInsideInterval =
      newLesserAngle < lesserAngles[i] && lesserAngles[i] < newGreaterAngle
    const greaterAngleIsInsideInterval =
      newLesserAngle < greaterAngles[i] && greaterAngles[i] < newGreaterAngle

    if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) continue

    if ((newLayerMask & layerMasks[i]) !== 0) {
      sameLayerIntersectionCount++
    } else {
      crossingLayerIntersectionCount++
    }
  }

  return [
    sameLayerIntersectionCount,
    crossingLayerIntersectionCount,
    entryExitLayerChanges,
  ]
}

export const countNewIntersections = (
  existingPairs: DynamicAnglePairArrays,
  newPair: DynamicAnglePair,
): [number, number, number] => {
  const [newNet, newLesserAngle, newZ1, newGreaterAngle, newZ2] = newPair
  return countNewIntersectionsWithValues(
    existingPairs,
    newNet,
    newLesserAngle,
    newGreaterAngle,
    (1 << newZ1) | (1 << newZ2),
    newZ1 !== newZ2 ? 1 : 0,
  )
}

export const countIntersectionsFromAnglePairsDynamic = countNewIntersections
