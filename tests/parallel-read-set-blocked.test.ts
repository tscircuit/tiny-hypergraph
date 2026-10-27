import { expect, test } from "bun:test"
import {
  ParallelRouteSearchPool,
  type ParallelSearchExecutor,
} from "../lib/parallel/ParallelRouteSearchPool"
import type { ParallelRouteSearchInput } from "../lib/parallel/ParallelRouteSearchTask"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("an additive assignment on a cached winning path requires a new search", async () => {
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
    VERBOSE: false,
  })
  solver.setup()
  const executor = createRouteSearchExecutor(4)
  const inputs: ParallelRouteSearchInput[] = []
  const observed: ParallelSearchExecutor = {
    persistentWorkerCount: 4,
    executeAsync: (Task, input) => {
      inputs.push(input)
      return executor.executeAsync(Task, input)
    },
  }
  const pool = new ParallelRouteSearchPool(solver, observed)
  try {
    await pool.start()
    const first = await pool.search(0, 10000)
    while (pool.finishedSearches < 4)
      await new Promise((resolve) => setTimeout(resolve, 1))
    solver.acceptParallelRouteSearch(0, first.candidate, first.iterations)
    const cached = inputs.find((input) => input.control[1] === 1)!
    let blocked = -1
    for (let i = 1; i + 1 < cached.control[5]!; i++) {
      const port = cached.pathIds[i * 4]!
      if (solver.state.portAssignment[port] === -1) {
        blocked = port
        break
      }
    }
    expect(blocked).toBeGreaterThanOrEqual(0)
    solver.state.portAssignment[blocked] = 1
    const result = await pool.search(1, 10000)
    expect(result.status).toBe("found")
    expect(pool.staleSearches).toBeGreaterThan(0)
    for (let node = result.candidate; node; node = node.prevCandidate)
      expect(node.portId).not.toBe(blocked)
  } finally {
    await pool.dispose()
    executor.dispose()
  }
})
