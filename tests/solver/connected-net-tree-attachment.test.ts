import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("attaches to proven preloaded copper and emits the reversed tail to the original endpoint", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  const options = {
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  }
  const control = new DistanceAwareTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    ...options,
    DYNAMIC_CONNECTED_NET_TREES: true,
    OWNED_REGIONAL_HOP_FRONTIER: true,
  })
  control.solve()
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBeLessThan(control.iterations)
  expect(
    solver.state.regionSegments.map((segments) =>
      segments.filter(([routeId]) => routeId === 1),
    ),
  ).toEqual([[[1, 0, 1]], [[1, 1, 2]], [[1, 2, 3]], [], [], []])
  const roundTrip = loadSerializedHyperGraph(solver.getOutput())
  expect([...roundTrip.problem.routeStartPort]).toEqual([3, 0])
  expect([...roundTrip.problem.routeEndPort]).toEqual([1, 3])
  expect(roundTrip.solution.solvedRoutePathSegments[1]).toHaveLength(3)
  expect(solver.stats.connectedTreeExpandedGoalAttempts).toBe(1)
})
