import { expect, test } from "bun:test"
import {
  cloneRegionIntersectionCache,
  createEmptyRegionIntersectionCache,
} from "lib/core"

test("empty region intersection caches share immutable empty values", () => {
  const firstCache = createEmptyRegionIntersectionCache()
  const secondCache = createEmptyRegionIntersectionCache()
  const clonedCache = cloneRegionIntersectionCache(firstCache)

  expect(firstCache.netIds).toBe(secondCache.netIds)
  expect(firstCache.netIds).toBe(clonedCache.netIds)

  firstCache.existingRegionCost = 1

  expect(secondCache.existingRegionCost).toBe(0)
  expect(clonedCache.existingRegionCost).toBe(0)
})
