import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("full rerips and problem resets discard old connected-tree membership", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  const options = {
    DYNAMIC_CONNECTED_NET_TREES: true,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  }
  const solver = new TinyHyperGraphSolver(topology, problem, options)
  solver.solve()
  expect(solver.solved).toBe(true)
  solver.resetRoutingStateForRerip()
  solver.state.unroutedRoutes = [1]
  solver._step()
  expect(solver.stats.connectedTreeGoalPortCount).toBe(1)
  expect(solver.state.currentRouteId).toBe(1)
  const nextProblem = {
    ...problem,
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([7]),
    initialAssignments: undefined,
  }
  solver.resetForProblem(nextProblem)
  const fresh = new TinyHyperGraphSolver(topology, nextProblem, options)
  solver.solve()
  fresh.solve()
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments).toEqual(fresh.state.regionSegments)
  expect(solver.iterations).toBe(fresh.iterations)
  expect(solver.stats.connectedTreeExpandedGoalAttempts).toBe(0)
})
