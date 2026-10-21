import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/index"
import { createInitialRoutingBudgetProblem } from "./fixtures/initial-routing-budget.fixture"

test("preloaded assignments cannot opt into the fresh-search extension", (): void => {
  const { topology, problem } = createInitialRoutingBudgetProblem()
  problem.initialAssignments = Array.from({ length: 22 }, (_, index) => ({
    routeId: 0,
    regionId: index + 1,
    fromPortId: index,
    toPortId: index + 1,
  }))
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 3,
    INITIAL_ROUTING_MAX_ITERATIONS: 300,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.iterations = solver.MAX_ITERATIONS
  solver.tryFinalAcceptance()
  expect(solver.MAX_ITERATIONS).toBe(3)
  expect(solver.state.unroutedRoutes).toHaveLength(0)
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(false)
})
