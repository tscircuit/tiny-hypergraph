import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

test("in-place resetForProblem invalidates committed copper even when net and port identities repeat", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  const options = {
    DYNAMIC_CONNECTED_NET_TREES: true,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  }
  const solver = new TinyHyperGraphSolver(topology, problem, options)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.connectedTreeExpandedGoalAttempts).toBe(1)
  const priorSegments = solver.state.regionSegments
  const nextProblem = {
    ...problem,
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([7]),
    initialAssignments: undefined,
  }
  solver.resetForProblem(nextProblem)
  expect(solver.state.regionSegments).toBe(priorSegments)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.connectedTreeExpandedGoalAttempts).toBe(0)
  expect(solver.state.regionSegments.flat()).toHaveLength(3)
})
