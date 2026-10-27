import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("already connected original endpoints retain an independently owned complete path", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  problem.routeStartPort[1] = 2
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(
    solver.state.regionSegments.flat().filter(([routeId]) => routeId === 1),
  ).toEqual([[1, 2, 3]])
  expect(solver.stats.connectedTreeExpandedGoalAttempts).toBe(1)
})
