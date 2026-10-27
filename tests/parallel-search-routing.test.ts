import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("distributed search routes overlapping nets within the shared budget", async () => {
  const executor = createRouteSearchExecutor(4)
  try {
    let searches = 0
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      const options = {
        STATIC_REACHABILITY_PRECHECK: false,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: false,
        MAX_ITERATIONS: 100000,
        RIP_THRESHOLD_START: Infinity,
        RIP_THRESHOLD_END: Infinity,
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
      expect(serial.solved).toBe(true)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.iterations).toBeLessThanOrEqual(options.MAX_ITERATIONS)
      expect(parallel.stats.parallelRouteWorkers).toBe(4)
      expect(parallel.stats.maximumParticipatingSearchWorkers).toBe(4)
      for (const [
        region,
        segments,
      ] of parallel.state.regionSegments.entries()) {
        for (const [route, from, to] of segments) {
          expect(topology.regionIncidentPorts[region]).toContain(from)
          expect(topology.regionIncidentPorts[region]).toContain(to)
          expect(parallel.state.portAssignment[from]).toBe(
            problem.routeNet[route]!,
          )
          expect(parallel.state.portAssignment[to]).toBe(
            problem.routeNet[route]!,
          )
        }
      }
      searches += Number(parallel.stats.parallelRouteSearches)
    }
    expect(searches).toBeGreaterThan(0)
  } finally {
    executor.dispose()
  }
})
