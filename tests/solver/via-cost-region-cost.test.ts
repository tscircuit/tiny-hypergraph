import { expect, test } from "bun:test"
import {
  computeRegionCost,
  computeRegionCostForArea,
  TRACE_VIA_MARGIN,
} from "lib/computeRegionCost"

test("fixed via cost charges physical crossings and transitions independently of region area", (): void => {
  const viaPadDiameter = 0.3
  const legacyCost =
    ((2 * 2 + 3 + 4) * (viaPadDiameter + TRACE_VIA_MARGIN) ** 2 * 2) / 200
  expect(computeRegionCost(10, 20, 2, 3, 4, 5)).toBeCloseTo(legacyCost)
  expect(computeRegionCostForArea(200, 2, 3, 4, 5)).toBeCloseTo(legacyCost)

  for (const area of [4, 200]) {
    const congestionCost = computeRegionCostForArea(
      area,
      2,
      3,
      4,
      5,
      3,
      viaPadDiameter,
      0,
      0,
    )
    const fixedViaCost = computeRegionCostForArea(
      area,
      2,
      3,
      4,
      5,
      3,
      viaPadDiameter,
      0,
      0,
      0.3,
    )
    expect(fixedViaCost - congestionCost).toBeCloseTo(0.3 * (2 * 2 + 4))
  }

  expect(
    computeRegionCost(10, 20, 0, 10, 0, 11, 3, viaPadDiameter, 0, 0, 0.3),
  ).toBe(0)
  expect(
    computeRegionCost(10, 20, 0, 10, 0, 11, 3, viaPadDiameter, 0, 0.5),
  ).toBeCloseTo(computeRegionCost(10, 20, 0, 10, 0, 11, 3, viaPadDiameter) / 2)
  expect(
    computeRegionCost(10, 20, 1, 0, 0, 2, 1, viaPadDiameter, 0, 0, 0.3),
  ).toBeGreaterThan(10)
})
