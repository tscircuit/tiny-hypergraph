import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createDistributedSearchExecutor } from "./fixtures/createDistributedSearchExecutor"

test("a four-worker executor shares one expansion budget across active owners", async () => {
  const { topology, problem } = createParallelGrid(1)
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 17,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    VERBOSE: false,
  })
  const executor = createDistributedSearchExecutor(4)
  try {
    await solveWithParallelSearch(solver, executor)
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.iterations).toBe(17)
    expect(solver.stats.parallelRouteExpansions).toBeLessThanOrEqual(17)
    expect(solver.stats.parallelRouteWorkers).toBe(4)
    expect(solver.stats.maximumParticipatingSearchWorkers).toBeGreaterThan(1)
  } finally {
    executor.dispose()
  }
})
