import { expect, test } from "bun:test"
import {
  orderRoutesAfterSelectiveRerip,
  selectOwnerRouteIdsToRip,
} from "lib/selective-rerip-tiny-hyper-graph-solver"

test("selects alternate owners and rejects a failed route as its only blocker", () => {
  expect([
    ...selectOwnerRouteIdsToRip({
      failedRouteId: 1,
      directOwnerRouteIds: [1, 2],
      alternateOwnerRouteIds: [3, 4],
    }),
  ]).toEqual([3, 4])

  expect(() =>
    selectOwnerRouteIdsToRip({
      failedRouteId: 1,
      directOwnerRouteIds: [1],
    }),
  ).toThrow(
    "SelectiveReripTinyHyperGraphSolver: route 1 has blocker resources but no distinct committed owner can be reripped",
  )
})

test("keeps pending routes ahead of newly ripped routes", () => {
  expect(
    orderRoutesAfterSelectiveRerip({
      failedRouteId: 7,
      pendingRouteIds: [3, 4, 8, 7, 9],
      rippedRouteIds: new Set([4, 2, 7]),
    }),
  ).toEqual([7, 3, 8, 9, 4, 2])
})
