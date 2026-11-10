import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/index"
import { createInitialRoutingBudgetProblem } from "./fixtures/initial-routing-budget.fixture"

test("an explicit initial budget continues the same unfinished search", (): void => {
  for (const initialBudget of [undefined, 300]) {
    const { topology, problem } = createInitialRoutingBudgetProblem()
    const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
      MAX_ITERATIONS: 3,
      INITIAL_ROUTING_MAX_ITERATIONS: initialBudget,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    })
    solver.solve()
    expect(solver.solved).toBe(initialBudget !== undefined)
    expect(solver.failed).toBe(initialBudget === undefined)
    expect(solver.MAX_ITERATIONS).toBe(initialBudget ?? 3)
    if (initialBudget !== undefined) {
      expect(solver.iterations).toBeGreaterThan(3)
      expect(solver.state.unroutedRoutes).toHaveLength(0)
    } else {
      expect(solver.iterations).toBe(3)
    }
  }
})
