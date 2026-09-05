import { expect, test } from "bun:test"
import { getBoundaryDuplicatePortPlacement } from "lib/getBoundaryDuplicatePortPlacement"

test.each([
  {
    sourcePoint: { x: 1, y: 0.5 },
    direction: { x: 0.8, y: 0.6 },
    expectedDirection: { x: 0, y: 1 },
    maxDistance: 0.05,
  },
  {
    sourcePoint: { x: 1, y: 1 },
    direction: { x: 0.8, y: 0.6 },
    expectedDirection: { x: 0, y: -1 },
    maxDistance: 0.05,
  },
  {
    sourcePoint: { x: 1, y: 0.99 },
    direction: { x: 0.8, y: 0.6 },
    expectedDirection: { x: 0, y: 1 },
    maxDistance: 0.01,
  },
])("duplicates stay on the vertical shared edge at $sourcePoint", (fixture) => {
  const placement = getBoundaryDuplicatePortPlacement({
    ...fixture,
    region1Bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    region2Bounds: { minX: 1, maxX: 2, minY: 0, maxY: 1 },
    duplicatePortProximity: 0.05,
  })
  expect(placement.direction).toEqual(fixture.expectedDirection)
  expect(placement.maxDistance).toBeCloseTo(fixture.maxDistance)
  for (const duplicateIndex of [1, 2, 3]) {
    const offset = (placement.maxDistance * duplicateIndex) / 4
    const x = fixture.sourcePoint.x + placement.direction.x * offset
    const y = fixture.sourcePoint.y + placement.direction.y * offset
    expect(x).toBe(1)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(1)
  }
})

test("duplicates follow a horizontal edge rather than the nearest port's diagonal", () => {
  const placement = getBoundaryDuplicatePortPlacement({
    sourcePoint: { x: 0.5, y: 1 },
    direction: { x: -0.6, y: -0.8 },
    region1Bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    region2Bounds: { minX: 0, maxX: 1, minY: 1, maxY: 2 },
    duplicatePortProximity: 0.05,
  })
  expect(placement.direction).toEqual({ x: -1, y: 0 })
  expect(placement.maxDistance).toBe(0.05)
})
