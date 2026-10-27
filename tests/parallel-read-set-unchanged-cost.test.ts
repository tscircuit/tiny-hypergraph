import { expect, test } from "bun:test"
import { ParallelRouteSearchPool } from "../lib/parallel/ParallelRouteSearchPool"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("changed read sets require a fresh search even when winning path costs are unchanged", async () => {
  const { topology, problem } = createParallelGrid(1)
  problem.routeCount = 4
  problem.routeStartPort = problem.routeStartPort.slice(0, 4)
  problem.routeEndPort = problem.routeEndPort.slice(0, 4)
  problem.routeNet = problem.routeNet.slice(0, 4)
  topology.portZ.fill(0)
  problem.routeNet.fill(0)
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    RIP_THRESHOLD_START: Infinity,
    RIP_THRESHOLD_END: Infinity,
    VERBOSE: false,
  })
  solver.setup()
  const executor = createRouteSearchExecutor(4)
  const pool = new ParallelRouteSearchPool(solver, executor)
  try {
    await pool.start()
    const first = await pool.search(0, 10000)
    while (pool.finishedSearches < 4)
      await new Promise((resolve) => setTimeout(resolve, 1))
    const finished = pool.finishedSearches
    solver.acceptParallelRouteSearch(0, first.candidate, first.iterations)
    const second = await pool.search(1, 10000)
    expect(second.status).toBe("found")
    expect(pool.finishedSearches).toBeGreaterThan(finished)
    expect(pool.staleSearches).toBeGreaterThan(0)
    solver.acceptParallelRouteSearch(1, second.candidate, second.iterations)
    expect(solver.state.unroutedRoutes).not.toContain(1)
  } finally {
    await pool.dispose()
    executor.dispose()
  }
})
