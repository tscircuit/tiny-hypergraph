import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("one and four landmark workers preserve identical routes and budgeted rerips", async () => {
  const single = createRouteSearchExecutor(1)
  const multiple = createRouteSearchExecutor(4)
  try {
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      problem.portPenalty = Float64Array.from(
        { length: topology.portCount },
        (_, port) => ((port * 13 + seed) % 5 === 0 ? 150 : 0),
      )
      const options = {
        MAX_ITERATIONS: 5000,
        RIP_THRESHOLD_START: 0.01,
        RIP_THRESHOLD_END: 0.01,
        TRACE_DENSITY_COST_FACTOR: 0.25,
        STATIC_REACHABILITY_PRECHECK: false,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: false,
        VERBOSE: false,
      }
      const a = new SelectiveReripTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      const b = new SelectiveReripTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      await solveWithParallelSearch(a, single, a.MAX_ITERATIONS, {
        useStaticLandmarks: true,
      })
      await solveWithParallelSearch(b, multiple, b.MAX_ITERATIONS, {
        useStaticLandmarks: true,
      })
      expect(b.solved).toBe(a.solved)
      expect(b.failed).toBe(a.failed)
      expect(b.iterations).toBe(a.iterations)
      expect(b.state.regionSegments).toEqual(a.state.regionSegments)
      expect(b.state.portAssignment).toEqual(a.state.portAssignment)
      expect(b.stats.ripCount).toBe(a.stats.ripCount)
    }
  } finally {
    single.dispose()
    multiple.dispose()
  }
})
