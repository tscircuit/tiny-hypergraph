import { expect, test } from "bun:test"
import {
  countNewIntersectionsWithValues,
  createDynamicAnglePairArrays,
} from "lib/countNewIntersections"
import type { DynamicAnglePair } from "lib2/types"
import { createEmptyCache, MutableRegionCache } from "lib2/region-cache"
import type { SegmentGeometry } from "lib2/segment-geometry"

const toGeometry = (pair: DynamicAnglePair): SegmentGeometry => ({
  lesserAngle: pair[1],
  greaterAngle: pair[3],
  layerMask: (1 << pair[2]) | (1 << pair[4]),
  entryExitLayerChanges: pair[2] !== pair[4] ? 1 : 0,
})

const computeTestCost = (
  sameLayerIntersections: number,
  crossingLayerIntersections: number,
  entryExitLayerChanges: number,
  segmentCount: number,
) =>
  sameLayerIntersections * 100 +
  crossingLayerIntersections * 10 +
  entryExitLayerChanges +
  segmentCount / 100

test("mutable region cache matches legacy incremental intersection counting", () => {
  const pairs: DynamicAnglePair[] = [
    [1, 1000, 0, 7000, 0],
    [2, 3000, 0, 9000, 1],
    [3, 2000, 2, 8000, 2],
    [1, 4000, 1, 6000, 1],
  ]
  const cache = MutableRegionCache.from(createEmptyCache())
  const existingPairs: DynamicAnglePair[] = []

  for (const pair of pairs) {
    const geometry = toGeometry(pair)
    const delta = cache.countDelta(pair[0], geometry)
    const legacyDelta = countNewIntersectionsWithValues(
      createDynamicAnglePairArrays(existingPairs),
      pair[0],
      geometry.lesserAngle,
      geometry.greaterAngle,
      geometry.layerMask,
      geometry.entryExitLayerChanges,
    )

    expect(delta).toEqual({
      sameLayerIntersections: legacyDelta[0],
      crossingLayerIntersections: legacyDelta[1],
      entryExitLayerChanges: legacyDelta[2],
    })

    const publicCache = cache.append(pair[0], geometry, delta, computeTestCost)
    existingPairs.push(pair)

    expect(publicCache.netIds).toHaveLength(existingPairs.length)
    expect(publicCache.lesserAngles).toHaveLength(existingPairs.length)
    expect(publicCache.greaterAngles).toHaveLength(existingPairs.length)
    expect(publicCache.layerMasks).toHaveLength(existingPairs.length)
    expect(publicCache.existingSegmentCount).toBe(existingPairs.length)
    expect(publicCache.existingRegionCost).toBe(
      computeTestCost(
        publicCache.existingSameLayerIntersections,
        publicCache.existingCrossingLayerIntersections,
        publicCache.existingEntryExitLayerChanges,
        publicCache.existingSegmentCount,
      ),
    )
  }
})
