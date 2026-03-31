import type { DynamicAnglePair, DynamicAnglePairArrays } from "./types"

export interface IntersectionCountScratch {
  sameLayerIntersectionCount: number
  crossingLayerIntersectionCount: number
  entryExitLayerChanges: number
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

export function countNewIntersectionsWithValues(
  existingPairs: DynamicAnglePairArrays,
  newNet: number,
  newLesserAngle: number,
  newGreaterAngle: number,
  newLayerMask: number,
  entryExitLayerChanges: number,
): [number, number, number]
export function countNewIntersectionsWithValues(
  existingPairs: DynamicAnglePairArrays,
  newNet: number,
  newLesserAngle: number,
  newGreaterAngle: number,
  newLayerMask: number,
  entryExitLayerChanges: number,
  scratch: IntersectionCountScratch,
): IntersectionCountScratch
export function countNewIntersectionsWithValues(
  existingPairs: DynamicAnglePairArrays,
  newNet: number,
  newLesserAngle: number,
  newGreaterAngle: number,
  newLayerMask: number,
  entryExitLayerChanges: number,
  scratch?: IntersectionCountScratch,
): [number, number, number] | IntersectionCountScratch {
  const netIds = existingPairs.netIds
  const lesserAngles = existingPairs.lesserAngles
  const greaterAngles = existingPairs.greaterAngles
  const layerMasks = existingPairs.layerMasks
  const length = netIds.length

  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0

  for (let i = 0; i < length; i++) {
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

  if (scratch) {
    scratch.sameLayerIntersectionCount = sameLayerIntersectionCount
    scratch.crossingLayerIntersectionCount = crossingLayerIntersectionCount
    scratch.entryExitLayerChanges = entryExitLayerChanges
    return scratch
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
