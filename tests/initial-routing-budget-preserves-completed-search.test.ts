import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/index"
import { createInitialRoutingBudgetProblem } from "./fixtures/initial-routing-budget.fixture"

class CompletedAssignmentProbe extends SelectiveReripTinyHyperGraphSolver {
  captureCompleteAssignmentAtLimit(): void {
    this.captureBestSolvedState({ maxRegionCost: 0, totalRegionCost: 0 })
    this.solved = false
    this.iterations = this.MAX_ITERATIONS
  }
}

test("a completed assignment retains its normal final acceptance budget", (): void => {
  const { topology, problem } = createInitialRoutingBudgetProblem()
  const solver = new CompletedAssignmentProbe(topology, problem, {
    MAX_ITERATIONS: 100,
    INITIAL_ROUTING_MAX_ITERATIONS: 1_600,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  solver.captureCompleteAssignmentAtLimit()
  solver.tryFinalAcceptance()
  expect(solver.MAX_ITERATIONS).toBe(100)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
