import { expect, test } from "bun:test"
import {
  createDynamicAnglePairArrays,
  setNewIntersectionCounts,
  type MutableIntersectionCount,
} from "lib/countNewIntersections"

test("intersection counting writes into reusable geometry storage", (): void => {
  const existingPairs = createDynamicAnglePairArrays([
    [1, 10, 0, 30, 0],
    [2, 20, 1, 40, 1],
  ])
  const intersectionCount: MutableIntersectionCount = {
    netId: 3,
    lesserAngle: 15,
    greaterAngle: 35,
    layerMask: 1,
    entryExitLayerChanges: 0,
    sameLayerIntersectionCount: -1,
    crossingLayerIntersectionCount: -1,
  }

  setNewIntersectionCounts(existingPairs, intersectionCount)

  expect(intersectionCount.sameLayerIntersectionCount).toBe(1)
  expect(intersectionCount.crossingLayerIntersectionCount).toBe(1)
  expect(intersectionCount.entryExitLayerChanges).toBe(0)
})
