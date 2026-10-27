import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("distant lookahead preserves serial ordering across more routes than the cached window", async () => {
  const { topology, problem } = createParallelGrid(5)
  for (const key of ["routeStartPort", "routeEndPort", "routeNet"] as const) {
    const values = Array.from(problem[key])
    problem[key] = Int32Array.from(
      Array.from({ length: 4 }, () => values).flat(),
    )
  }
  problem.routeCount *= 4
  const options = {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    MAX_ITERATIONS: 100000,
    RIP_THRESHOLD_START: Infinity,
    RIP_THRESHOLD_END: Infinity,
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
  const executor = createRouteSearchExecutor(4)
  try {
    serial.solve()
    await solveWithParallelSearch(parallel, executor)
    expect(serial.solved).toBe(true)
    expect(parallel.solved).toBe(true)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
    expect(parallel.state.regionIntersectionCaches).toEqual(
      serial.state.regionIntersectionCaches,
    )
    expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
    expect(parallel.stats.maximumParticipatingSearchWorkers).toBe(4)
  } finally {
    executor.dispose()
  }
})
