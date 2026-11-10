import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("numeric worker inputs preserve seeded routing without cloning application metadata", async () => {
  const { topology, problem } = createParallelGrid(3)
  const options = {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    MAX_ITERATIONS: 100000,
    RIP_THRESHOLD_START: Infinity,
    RIP_THRESHOLD_END: Infinity,
  }
  const seed = new SelectiveReripTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  seed.solve()
  expect(seed.solved).toBe(true)
  problem.initialAssignments = seed.state.regionSegments.flatMap(
    (segments, regionId) =>
      segments
        .filter(([route]) => route === 0)
        .map(([routeId, fromPortId, toPortId]) => ({
          routeId,
          regionId,
          fromPortId,
          toPortId,
        })),
  )
  expect(problem.initialAssignments.length).toBeGreaterThan(0)
  // Functions are deliberately not structured-cloneable.
  topology.regionMetadata = [{ render: () => "region" }]
  topology.portMetadata = [{ render: () => "port" }]
  problem.routeMetadata = [{ render: () => "route" }]
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
    expect(parallel.solved).toBe(true)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
    expect(parallel.state.regionIntersectionCaches).toEqual(
      serial.state.regionIntersectionCaches,
    )
    expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
    expect(parallel.stats.maximumParticipatingSearchWorkers).toBe(4)
    expect(problem.initialAssignments.length).toBeGreaterThan(0)
    expect(problem.routeMetadata[0].render()).toBe("route")
  } finally {
    executor.dispose()
  }
})
