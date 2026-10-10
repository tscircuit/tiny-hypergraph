import type { DynamicAnglePair, DynamicAnglePairArrays } from "./types"

export type MutableIntersectionCount = {
  netId: number
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
  sameLayerIntersectionCount: number
  crossingLayerIntersectionCount: number
}

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
  const intersectionCount: MutableIntersectionCount = {
    netId: newNet,
    lesserAngle: newLesserAngle,
    greaterAngle: newGreaterAngle,
    layerMask: newLayerMask,
    entryExitLayerChanges,
    sameLayerIntersectionCount: 0,
    crossingLayerIntersectionCount: 0,
  }
  setNewIntersectionCounts(existingPairs, intersectionCount)

  return [
    intersectionCount.sameLayerIntersectionCount,
    intersectionCount.crossingLayerIntersectionCount,
    intersectionCount.entryExitLayerChanges,
  ]
}

export const setNewIntersectionCounts = (
  existingPairs: DynamicAnglePairArrays,
  intersectionCount: MutableIntersectionCount,
): void => {
  const { netIds, lesserAngles, greaterAngles, layerMasks } = existingPairs
  const { netId, lesserAngle, greaterAngle, layerMask } = intersectionCount

  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0

  for (let i = 0; i < netIds.length; i++) {
    if (netId === netIds[i]) continue
    // Proper boundary-chord crossings require four distinct endpoints.
    // Counting a shared angle would otherwise depend on insertion order.
    if (
      lesserAngle === lesserAngles[i] ||
      lesserAngle === greaterAngles[i] ||
      greaterAngle === lesserAngles[i] ||
      greaterAngle === greaterAngles[i]
    )
      continue

    const lesserAngleIsInsideInterval =
      lesserAngle < lesserAngles[i] && lesserAngles[i] < greaterAngle
    const greaterAngleIsInsideInterval =
      lesserAngle < greaterAngles[i] && greaterAngles[i] < greaterAngle

    if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) continue

    if ((layerMask & layerMasks[i]) !== 0) {
      sameLayerIntersectionCount++
    } else {
      crossingLayerIntersectionCount++
    }
  }

  intersectionCount.sameLayerIntersectionCount = sameLayerIntersectionCount
  intersectionCount.crossingLayerIntersectionCount =
    crossingLayerIntersectionCount
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
