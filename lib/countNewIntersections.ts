import type { DynamicAnglePair, DynamicAnglePairArrays } from "./types"

export type RegionCostModel = "legacy" | "routing-risk" | "routing-complexity"

export const classifyIntersectionLayerMasks = (
  firstLayerMask: number,
  secondLayerMask: number,
  regionCostModel: RegionCostModel,
): "same-layer" | "transition-pair" | undefined => {
  if (regionCostModel === "legacy") {
    return (firstLayerMask & secondLayerMask) !== 0
      ? "same-layer"
      : "transition-pair"
  }

  // Detailed routing consumes every segment pair, including region re-entry.
  // A transition crossing a fixed chord competes for via placement and is a
  // blocking interaction, while fixed chords on disjoint layers do not
  // interact. Same-net ownership is handled by the caller/cache.
  if (regionCostModel === "routing-complexity") {
    const firstChangesLayer =
      firstLayerMask > 0 && (firstLayerMask & (firstLayerMask - 1)) !== 0
    const secondChangesLayer =
      secondLayerMask > 0 && (secondLayerMask & (secondLayerMask - 1)) !== 0
    if (firstChangesLayer && secondChangesLayer) return "transition-pair"
    if (firstChangesLayer || secondChangesLayer) return "same-layer"
    return (firstLayerMask & secondLayerMask) !== 0 ? "same-layer" : undefined
  }

  const firstChangesLayer =
    firstLayerMask > 0 && (firstLayerMask & (firstLayerMask - 1)) !== 0
  const secondChangesLayer =
    secondLayerMask > 0 && (secondLayerMask & (secondLayerMask - 1)) !== 0
  if (firstChangesLayer || secondChangesLayer) {
    return firstChangesLayer && secondChangesLayer
      ? "transition-pair"
      : undefined
  }
  return (firstLayerMask & secondLayerMask) !== 0 ? "same-layer" : undefined
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

export const countNewIntersectionsWithValuesInto = (
  existingPairs: DynamicAnglePairArrays,
  newNet: number,
  newLesserAngle: number,
  newGreaterAngle: number,
  newLayerMask: number,
  entryExitLayerChanges: number,
  regionCostModel: RegionCostModel,
  output: Int32Array | [number, number, number],
): void => {
  const { netIds, lesserAngles, greaterAngles, layerMasks } = existingPairs

  // Downstream risk groups all points for one connection into one chord and
  // uses its first pair. A route that re-enters a region therefore must not
  // add another transition or crossing to that region's risk estimate.
  if (regionCostModel === "routing-risk" && netIds.includes(newNet)) {
    output[0] = 0
    output[1] = 0
    output[2] = 0
    return
  }

  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0
  const newChangesLayer =
    newLayerMask > 0 && (newLayerMask & (newLayerMask - 1)) !== 0

  if (regionCostModel === "legacy") {
    for (let i = 0; i < netIds.length; i++) {
      if (newNet === netIds[i]) continue
      const lesserAngleIsInsideInterval =
        newLesserAngle < lesserAngles[i]! && lesserAngles[i]! < newGreaterAngle
      const greaterAngleIsInsideInterval =
        newLesserAngle < greaterAngles[i]! &&
        greaterAngles[i]! < newGreaterAngle
      if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) {
        continue
      }
      const existingLayerMask = layerMasks[i]!
      if ((newLayerMask & existingLayerMask) !== 0) {
        sameLayerIntersectionCount++
      } else {
        crossingLayerIntersectionCount++
      }
    }
  } else if (regionCostModel === "routing-complexity") {
    for (let i = 0; i < netIds.length; i++) {
      if (newNet === netIds[i]) continue
      const lesserAngleIsInsideInterval =
        newLesserAngle < lesserAngles[i]! && lesserAngles[i]! < newGreaterAngle
      const greaterAngleIsInsideInterval =
        newLesserAngle < greaterAngles[i]! &&
        greaterAngles[i]! < newGreaterAngle
      if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) {
        continue
      }
      const existingLayerMask = layerMasks[i]!
      const existingChangesLayer =
        existingLayerMask > 0 &&
        (existingLayerMask & (existingLayerMask - 1)) !== 0
      if (newChangesLayer && existingChangesLayer) {
        crossingLayerIntersectionCount++
      } else if (
        newChangesLayer ||
        existingChangesLayer ||
        (newLayerMask & existingLayerMask) !== 0
      ) {
        sameLayerIntersectionCount++
      }
    }
  } else {
    for (let i = 0; i < netIds.length; i++) {
      if (newNet === netIds[i]) continue
      // Chords meeting at a shared boundary point can join without crossing.
      // The downstream circle counter explicitly excludes these pairs.
      if (
        newLesserAngle === lesserAngles[i] ||
        newLesserAngle === greaterAngles[i] ||
        newGreaterAngle === lesserAngles[i] ||
        newGreaterAngle === greaterAngles[i]
      ) {
        continue
      }
      const lesserAngleIsInsideInterval =
        newLesserAngle < lesserAngles[i]! && lesserAngles[i]! < newGreaterAngle
      const greaterAngleIsInsideInterval =
        newLesserAngle < greaterAngles[i]! &&
        greaterAngles[i]! < newGreaterAngle
      if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) {
        continue
      }
      const existingLayerMask = layerMasks[i]!
      const existingChangesLayer =
        existingLayerMask > 0 &&
        (existingLayerMask & (existingLayerMask - 1)) !== 0
      if (newChangesLayer || existingChangesLayer) {
        if (newChangesLayer && existingChangesLayer) {
          crossingLayerIntersectionCount++
        }
      } else if ((newLayerMask & existingLayerMask) !== 0) {
        sameLayerIntersectionCount++
      }
    }
  }

  output[0] = sameLayerIntersectionCount
  output[1] = crossingLayerIntersectionCount
  output[2] = entryExitLayerChanges
}

export const countNewIntersectionsWithValues = (
  existingPairs: DynamicAnglePairArrays,
  newNet: number,
  newLesserAngle: number,
  newGreaterAngle: number,
  newLayerMask: number,
  entryExitLayerChanges: number,
  regionCostModel: RegionCostModel = "legacy",
): [number, number, number] => {
  const output: [number, number, number] = [0, 0, 0]
  countNewIntersectionsWithValuesInto(
    existingPairs,
    newNet,
    newLesserAngle,
    newGreaterAngle,
    newLayerMask,
    entryExitLayerChanges,
    regionCostModel,
    output,
  )
  return output
}

export const countNewIntersections = (
  existingPairs: DynamicAnglePairArrays,
  newPair: DynamicAnglePair,
  regionCostModel: RegionCostModel = "legacy",
): [number, number, number] => {
  const [newNet, newLesserAngle, newZ1, newGreaterAngle, newZ2] = newPair
  return countNewIntersectionsWithValues(
    existingPairs,
    newNet,
    newLesserAngle,
    newGreaterAngle,
    (1 << newZ1) | (1 << newZ2),
    newZ1 !== newZ2 ? 1 : 0,
    regionCostModel,
  )
}

export const countIntersectionsFromAnglePairsDynamic = countNewIntersections
