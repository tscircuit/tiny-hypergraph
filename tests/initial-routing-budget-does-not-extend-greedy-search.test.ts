import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "../lib/index"
import { createInitialRoutingBudgetProblem } from "./fixtures/initial-routing-budget.fixture"

class GreedyBudgetProbe extends TinyHyperGraphSolver {
  greedyBudgets: TinyHyperGraphSolverOptions[] = []

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    this.greedyBudgets.push(options)
    return super.createGreedyFinalRouteSolver(options, attempt)
  }
}

test("the initial-search extension is not copied into greedy final searches", (): void => {
  const { topology, problem } = createInitialRoutingBudgetProblem()
  const solver = new GreedyBudgetProbe(topology, problem, {
    MAX_ITERATIONS: 3,
    INITIAL_ROUTING_MAX_ITERATIONS: 4,
    GREEDY_FINAL_ROUTE_ITERS: 1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.solve()
  expect(solver.greedyBudgets.length).toBeGreaterThan(0)
  for (const options of solver.greedyBudgets) {
    expect(options.INITIAL_ROUTING_MAX_ITERATIONS).toBeUndefined()
    expect(options.MAX_ITERATIONS).toBe(50_000)
  }
})
