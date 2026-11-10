import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("searches from the unconnected endpoint toward the source tree and restores demand orientation", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  problem.routeStartPort[1] = 3
  problem.routeEndPort[1] = 0
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.connectedTreeReversedAttempts).toBe(1)
  expect(solver.stats.connectedTreeCopiedSegmentCount).toBe(2)
  expect(
    solver.state.regionSegments.map((segments) =>
      segments.filter(([routeId]) => routeId === 1),
    ),
  ).toEqual([[[1, 1, 0]], [[1, 2, 1]], [[1, 3, 2]], [], [], []])
})
