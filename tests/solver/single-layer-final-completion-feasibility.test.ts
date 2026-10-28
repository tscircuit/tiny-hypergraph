import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("zero-cost final completion takes the legal detour instead of crossing a retained single-layer net", () => {
  for (const mask of [1, 2, 4, 8, 3]) {
    const { topology, problem } = createSingleLayerCompletionFixture(mask)
    const parent = new TinyHyperGraphSolver(topology, problem, {
      MAX_ITERATIONS: 2000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 1,
      PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false,
    })
    parent.tryFinalAcceptance()
    expect(parent.solved && !parent.failed).toBe(true)
    expect(parent.stats.greedyFinalRouteIter).toBe(0)
    expect(parent.stats.finalRoutingStrategy).toBe("greedy")
    expect(parent.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(mask === 3 ? 1 : 0)
    expect(parent.state.regionSegments[0].length).toBe(mask === 3 ? 2 : 1)
    const usedRegions = parent.state.regionSegments.flatMap((segments, regionId) =>
      segments.some(([routeId]) => routeId === 1) ? [regionId] : [],
    )
    expect(usedRegions).toContain(mask === 3 ? 0 : 2)
  }
  const sameOwner = createSingleLayerCompletionFixture(8)
  sameOwner.problem.routeNet[1] = 0
  const shared = new TinyHyperGraphSolver(sameOwner.topology, sameOwner.problem, { STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 1 })
  shared.tryFinalAcceptance()
  expect(shared.solved && !shared.failed).toBe(true)
  expect(shared.state.regionSegments[0].length).toBe(2)
  expect(shared.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(0)
})
