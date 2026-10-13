import { expect, test } from "bun:test"
import {
  cloneRegionIntersectionCache,
  createEmptyRegionIntersectionCache,
} from "../lib/regionIntersectionCache"

test("empty region caches share immutable-length storage", () => {
  const firstCache = createEmptyRegionIntersectionCache()
  const secondCache = createEmptyRegionIntersectionCache()

  expect(firstCache).not.toBe(secondCache)
  expect(firstCache.netIds).toBe(secondCache.netIds)
  expect(firstCache.lesserAngles).toBe(secondCache.lesserAngles)
  expect(firstCache.greaterAngles).toBe(secondCache.greaterAngles)
  expect(firstCache.layerMasks).toBe(secondCache.layerMasks)
})

test("cloned populated region caches retain independent storage", () => {
  const populatedCache = {
    ...createEmptyRegionIntersectionCache(),
    netIds: Int32Array.from([1]),
    lesserAngles: Int32Array.from([90]),
    greaterAngles: Int32Array.from([270]),
    layerMasks: Int32Array.from([3]),
    existingSegmentCount: 1,
  }

  const clonedCache = cloneRegionIntersectionCache(populatedCache)

  expect(clonedCache.netIds).not.toBe(populatedCache.netIds)
  expect(clonedCache.lesserAngles).not.toBe(populatedCache.lesserAngles)
  expect(clonedCache.greaterAngles).not.toBe(populatedCache.greaterAngles)
  expect(clonedCache.layerMasks).not.toBe(populatedCache.layerMasks)
  expect(clonedCache.netIds).toEqual(Int32Array.from([1]))
})
