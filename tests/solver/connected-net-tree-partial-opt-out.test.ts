import { expect, test } from "bun:test"
import { OutsideInPartialRipTinyHyperGraphSolver } from "lib/outside-in-partial-rip-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

class PartialSpanSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  reopenOriginalSpan(): void {
    this.partialRipRoutePlans.set(1, {
      routeId: 1, activeStartPortId: 0, activeEndPortId: 3,
      forcedStartRegionId: 0, forcedEndRegionId: 2,
      rippedSegmentCount: 3, retainedSegmentCount: 0,
    })
  }
}

test("partial-span searches keep their original routing policy even when endpoints match the original demand", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  const solver = new PartialSpanSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true, PARTIAL_RIP_ENABLED: true,
    OUTSIDE_IN_ROUTING: false, STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.reopenOriginalSpan()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.connectedTreeRouteAttempts).toBeUndefined()
  expect(solver.state.regionSegments.flat().filter(([routeId]) => routeId === 1))
    .toEqual([[1, 0, 1], [1, 1, 2], [1, 2, 3]])
})
