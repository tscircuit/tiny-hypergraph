import { expect, test } from "bun:test"
import { computeTraceOccupancyCost } from "lib"

test("trace occupancy charges only shared swept copper on the busiest layer", () => {
  expect(computeTraceOccupancyCost(2, [4], [4])).toBe(0)
  expect(computeTraceOccupancyCost(2, [7, 20], [4, 19])).toBeCloseTo(0.09)
  expect(
    computeTraceOccupancyCost(2, [7, 20], [4, 19], 0.15, 0.25),
  ).toBeCloseTo(0.36)
})
