import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerSearchResult } from "lib/find-distinct-owner-blocker-path"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import type {
  RelaxedSearchHopData,
  RelaxedSearchState,
} from "lib/selective-rerip/relaxedBlockerSearchTypes"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

class OwnerRipSolver extends SelectiveReripTinyHyperGraphSolver {
  protected override findRelaxedBlockerPathPreferringPreservedRoutes(): DistinctOwnerBlockerSearchResult<
    RelaxedSearchState,
    number,
    RelaxedSearchHopData
  > {
    return {
      found: true,
      states: [],
      hops: [],
      owners: new Set([0]),
      distance: 1,
      expandedLabelCount: 1,
    }
  }
}

test("selectively ripping the source owner preserves copied demand connectivity and rebuilds goals", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  problem.routeCount = 3
  problem.routeStartPort = new Int32Array([3, 0, 4])
  problem.routeEndPort = new Int32Array([1, 3, 0])
  problem.routeNet = new Int32Array([7, 7, 8])
  const solver = new OwnerRipSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver._setup()
  solver.state.unroutedRoutes = [1]
  while (!solver.state.regionSegments[0]!.some(([routeId]) => routeId === 1))
    solver._step()
  solver.state.currentRouteId = 2
  solver.state.currentRouteNetId = 8
  solver.state.unroutedRoutes = []
  solver.onOutOfCandidates()
  expect(solver.getSelectiveReripStats().lastRippedRouteIds).toEqual([0])
  expect(
    solver.state.regionSegments.flat().filter(([routeId]) => routeId === 0),
  ).toEqual([])
  expect(
    solver.state.regionSegments.flat().filter(([routeId]) => routeId === 1),
  ).toEqual([
    [1, 0, 1],
    [1, 1, 2],
    [1, 2, 3],
  ])
  solver.state.unroutedRoutes = [0]
  solver._step()
  expect(solver.stats.connectedTreeGoalPortCount).toBe(4)
  expect(
    solver.state.regionSegments.flat().some(([routeId]) => routeId === 0),
  ).toBe(true)
})
