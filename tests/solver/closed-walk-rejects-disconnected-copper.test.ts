import { expect, test } from "bun:test"
import { orderClosedRouteSegments } from "../../lib/compat/orderClosedRouteSegments"

test("a closed route rejects disconnected copper even when every port has even degree", () => {
  expect(() =>
    orderClosedRouteSegments(0, 0, [
      { fromPortId: 0, toPortId: 1, regionId: 0 },
      { fromPortId: 1, toPortId: 0, regionId: 0 },
      { fromPortId: 2, toPortId: 3, regionId: 1 },
      { fromPortId: 3, toPortId: 2, regionId: 1 },
    ]),
  ).toThrow("disconnected")
})
