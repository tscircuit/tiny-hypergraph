import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("partial workers preserve timeout prefixes and one-sided transitions", async () => {
  const executor = createRouteSearchExecutor(4)
  let fallbacks = 0
  try {
    for (const budget of [900, 1200, 1600, 3000, 12000]) {
      const { topology, problem } = createParallelGrid(2)
      const options = {
        MAX_ITERATIONS: budget,
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
        OUTSIDE_IN_MAX_DISTANCE: 0.1,
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
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
      expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
      for (const key of [
        "outsideInRouteCount",
        "outsideInCompletedRouteCount",
        "outsideInFallbackRouteCount",
        "outsideInForwardExpansionCount",
        "outsideInReverseExpansionCount",
        "outsideInDistancePruneCount",
      ])
        expect(parallel.stats[key]).toBe(serial.stats[key])
      fallbacks += Number(serial.stats.outsideInFallbackRouteCount ?? 0)
    }
    expect(fallbacks).toBeGreaterThan(0)
  } finally {
    executor.dispose()
  }
})
