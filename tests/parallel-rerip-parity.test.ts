import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("a packed single worker preserves negotiated rerips and best-state acceptance", async () => {
  const { topology, problem } = createParallelGrid(2)
  const options = {
    MAX_ITERATIONS: 5000,
    RIP_THRESHOLD_START: 0.01,
    RIP_THRESHOLD_END: 0.01,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    TRACE_DENSITY_COST_FACTOR: 0.25,
    STATIC_REACHABILITY_PRECHECK: false,
    VERBOSE: false,
  }
  const reference = new SelectiveReripTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  const parallel = new SelectiveReripTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  reference.solve()
  const executor = createRouteSearchExecutor(1)
  try {
    await solveWithParallelSearch(parallel, executor)
    expect(Number(reference.stats.ripCount)).toBeGreaterThan(0)
    expect(parallel.solved).toBe(reference.solved)
    expect(parallel.failed).toBe(reference.failed)
    expect(parallel.iterations).toBe(reference.iterations)
    expect(parallel.stats.ripCount).toBe(reference.stats.ripCount)
    expect(parallel.state.regionSegments).toEqual(
      reference.state.regionSegments,
    )
    expect(parallel.state.portAssignment).toEqual(
      reference.state.portAssignment,
    )
    expect(parallel.state.regionIntersectionCaches).toEqual(
      reference.state.regionIntersectionCaches,
    )
  } finally {
    executor.dispose()
  }
})
