import { expect, test } from "bun:test"
import { orderClosedRouteSegments } from "../../lib/compat/orderClosedRouteSegments"

test("a closed route rejects an unfinished branch", () => {
  expect(() =>
    orderClosedRouteSegments(0, 0, [
      { fromPortId: 0, toPortId: 1, regionId: 0 },
      { fromPortId: 1, toPortId: 0, regionId: 0 },
      { fromPortId: 1, toPortId: 2, regionId: 1 },
    ]),
  ).toThrow("open branch")
})
