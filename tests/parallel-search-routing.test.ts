import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createDistributedSearchExecutor } from "./fixtures/createDistributedSearchExecutor"

test("distributed search routes overlapping nets within the shared budget", async () => {
  const executor = createDistributedSearchExecutor(4)
  try {
    let messages = 0
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      const options = {
        STATIC_REACHABILITY_PRECHECK: false,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: false,
        MAX_ITERATIONS: 100000,
        VERBOSE: false,
      }
      const serial = new SelectiveReripTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      const parallel = new SelectiveReripTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      serial.solve()
      await solveWithParallelSearch(parallel, executor)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.iterations).toBeLessThanOrEqual(options.MAX_ITERATIONS)
      expect(parallel.stats.parallelRouteWorkers).toBe(4)
      expect(parallel.stats.maximumParticipatingSearchWorkers).toBe(4)
      messages += Number(parallel.stats.parallelSearchMessages)
    }
    expect(messages).toBeGreaterThan(0)
  } finally {
    executor.dispose()
  }
})
