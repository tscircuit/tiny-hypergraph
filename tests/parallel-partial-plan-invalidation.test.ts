import { expect, test } from "bun:test"
import { OutsideInPartialRipTinyHyperGraphSolver } from "../lib/outside-in-partial-rip-tiny-hypergraph-solver"
import { ParallelRouteSearchPool } from "../lib/parallel/ParallelRouteSearchPool"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

class PlannedSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  setPlan(routeId: number, start: number, end: number): void {
    this.partialRipRoutePlans.set(routeId, {
      routeId,
      activeStartPortId: start,
      activeEndPortId: end,
      forcedStartRegionId: this.topology.incidentPortRegion[start]![0]!,
      forcedEndRegionId: this.topology.incidentPortRegion[end]![0]!,
      rippedSegmentCount: 1,
      retainedSegmentCount: 1,
    })
  }
}

test("a changed partial plan invalidates cached work even when graph versions are unchanged", async () => {
  const { topology, problem } = createParallelGrid(1)
  problem.routeCount = 4
  problem.routeStartPort = problem.routeStartPort.slice(0, 4)
  problem.routeEndPort = problem.routeEndPort.slice(0, 4)
  problem.routeNet = new Int32Array(4)
  topology.portZ.fill(0)
  const solver = new PlannedSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: true,
    PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
    PARTIAL_RIP_MAX_ROUTE_COUNT: Infinity,
    VERBOSE: false,
  })
  solver.setup()
  solver.setPlan(1, problem.routeStartPort[1]!, problem.routeEndPort[1]!)
  const executor = createRouteSearchExecutor(4)
  const pool = new ParallelRouteSearchPool(solver, executor)
  try {
    await pool.start()
    expect((await pool.search(0, 10000)).status).toBe("found")
    while (pool.finishedSearches < 4)
      await new Promise((resolve) => setTimeout(resolve, 1))
    const before = pool.finishedSearches
    solver.setPlan(1, problem.routeStartPort[2]!, problem.routeEndPort[2]!)
    const result = await pool.search(1, 10000)
    expect(result.status).toBe("found")
    expect(pool.finishedSearches).toBeGreaterThan(before)
    expect(pool.staleSearches).toBeGreaterThan(0)
    expect(result.candidate!.portId).toBe(problem.routeEndPort[2]!)
    let root = result.candidate!
    while (root.prevCandidate) root = root.prevCandidate
    expect(root.portId).toBe(problem.routeStartPort[2]!)
  } finally {
    await pool.dispose()
    executor.dispose()
  }
})
