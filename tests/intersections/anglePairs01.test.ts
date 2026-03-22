import { expect, test } from "bun:test"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import { mapPortsToAnglePairs } from "lib/mapPortsToAnglePairs"

const sample = [
  [
    { x: 0, y: 0.5, z: 0, net: 0 },
    { x: 1, y: 0.5, z: 0, net: 0 },
  ],
  [
    { x: 0, y: 0, z: 0, net: 1 },
    { x: 1, y: 1, z: 0, net: 1 },
  ],
] satisfies Parameters<typeof mapPortsToAnglePairs>[1]

test("anglePairs01", () => {
  const [
    sameLayerIntersectionCount,
    crossingLayerIntersectionCount,
    entryExitChanges,
  ] = countIntersectionsFromAnglePairsDynamic(
    mapPortsToAnglePairs(
      {
        x: 0,
        y: 0,
      },
      sample,
    ),
  )

  expect(sameLayerIntersectionCount).toBe(1)
  expect(crossingLayerIntersectionCount).toBe(0)
  expect(entryExitChanges).toBe(0)
})
