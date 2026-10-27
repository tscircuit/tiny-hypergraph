import { expect, test } from "bun:test"
import { type Candidate } from "lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { createConnectedNetTreeFixture } from "tests/fixtures/connected-net-tree.fixture"

class GoalCostSolver extends DistanceAwareTinyHyperGraphSolver {
  acceptedGoalCost = -1
  override onPathFound(candidate: Candidate): void {
    this.acceptedGoalCost = candidate.g
    super.onPathFound(candidate)
  }
}

test("pays the final attachment edge and port penalty before committing a tree goal", () => {
  const { topology, problem } = createConnectedNetTreeFixture()
  problem.portPenalty = new Float64Array([0, 20, 0, 0, 0])
  const solver = new GoalCostSolver(topology, problem, {
    DYNAMIC_CONNECTED_NET_TREES: true, STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.acceptedGoalCost).toBeCloseTo(20.5)
})
