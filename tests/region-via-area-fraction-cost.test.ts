import { expect, test } from "bun:test"
import { computeRegionCost } from "lib/computeRegionCost"

test("viaAreaFraction scales only the via term of the region cost", () => {
  // A 1 x 1 region with two layers (mask 0b11), one entry/exit layer change,
  // and four traces under the trace-density penalty.
  const viaOnly = (viaAreaFraction: number) =>
    computeRegionCost(1, 1, 0, 0, 1, 4, 0b11, 0.3, 0, viaAreaFraction)
  const densityOnly = (viaAreaFraction: number) =>
    computeRegionCost(1, 1, 0, 0, 0, 4, 0b11, 0.3, 1, viaAreaFraction)

  expect(viaOnly(0.1)).toBeCloseTo(viaOnly(1) * 10, 12)
  expect(densityOnly(0.1)).toBe(densityOnly(1))
  expect(densityOnly(1)).toBeGreaterThan(0)
})
