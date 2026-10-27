import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("an interior tree goal cannot admit a new edge through an excluded section port", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  problem.portSectionMask[1] = 0
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true, STATIC_REACHABILITY_PRECHECK: false,
  })
  solver._setup()
  solver._step()
  expect(solver.state.currentRouteId).toBe(1)
  expect(solver.state.candidateQueue.length).toBe(0)
  expect(solver.state.regionSegments.flat().filter(([routeId]) => routeId === 1)).toEqual([])
  expect(solver.stats.connectedTreeExpandedGoalAttempts).toBe(1)
})
