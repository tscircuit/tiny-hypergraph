import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("partial-window worker searches preserve serial routes, budgets and expansion counters", async () => {
  const executor = createRouteSearchExecutor(4)
  try {
    let partialSearches = 0
    for (let seed = 1; seed <= 6; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      const options = {
        MAX_ITERATIONS: 20000,
        STATIC_REACHABILITY_PRECHECK: false,
        VERBOSE: false,
        RIP_THRESHOLD_START: 0.01,
        RIP_THRESHOLD_END: 0.01,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 4,
        TRACE_DENSITY_COST_FACTOR: 0.25,
        PARTIAL_RIP_ENABLED: true,
        OUTSIDE_IN_ROUTING: true,
        PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
        PARTIAL_RIP_MAX_ROUTE_COUNT: Infinity,
        PARTIAL_RIP_MAX_ATTEMPTS: 3,
        PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS: 0,
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
      expect(Number(serial.stats.partialRipCount)).toBeGreaterThan(0)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
      expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
      expect(parallel.state.regionIntersectionCaches).toEqual(
        serial.state.regionIntersectionCaches,
      )
      for (const key of [
        "outsideInRouteCount",
        "outsideInCompletedRouteCount",
        "outsideInFallbackRouteCount",
        "outsideInForwardExpansionCount",
        "outsideInReverseExpansionCount",
        "outsideInDistancePruneCount",
      ])
        expect(parallel.stats[key]).toBe(serial.stats[key])
      partialSearches += Number(parallel.stats.parallelPartialSearches)
    }
    expect(partialSearches).toBeGreaterThan(0)
  } finally {
    executor.dispose()
  }
})
