import { expect, test } from "bun:test"
import { computeRegionCost } from "lib/computeRegionCost"

test("trace-density cost penalizes concentrated parallel routes", () => {
  const sparseCost = computeRegionCost(2, 2, 0, 0, 0, 2, 0, 0.3, 1)
  const denseCost = computeRegionCost(2, 2, 0, 0, 0, 8, 0, 0.3, 1)
  const singleLayerDenseCost = computeRegionCost(
    2,
    2,
    0,
    0,
    0,
    8,
    1,
    0.3,
    1,
  )
  const twoLayerDenseCost = computeRegionCost(2, 2, 0, 0, 0, 8, 3, 0.3, 1)
  const legacyDenseCost = computeRegionCost(2, 2, 0, 0, 0, 8)

  expect(legacyDenseCost).toBe(0)
  expect(sparseCost).toBeGreaterThan(0)
  expect(denseCost).toBeGreaterThan(sparseCost)
  expect(singleLayerDenseCost).toBeGreaterThan(twoLayerDenseCost)
})
