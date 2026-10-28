import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("final completion avoids certified via-free crossings while preserving legacy and permitted-owner choices", () => {
  for (const mask of [1, 2, 4, 8, 3, 7]) {
    for (const allowed of [undefined, new Set<number>(), new Set([0]), new Set([1])]) {
      const blocked = allowed !== undefined && allowed.size === 0
      const { topology, problem } = createSingleLayerCompletionFixture(mask, false, allowed)
      const parent = new TinyHyperGraphSolver(topology, problem, {
        MAX_ITERATIONS: 2000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 1,
        PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false,
      })
      parent.tryFinalAcceptance()
      expect(parent.solved && !parent.failed).toBe(true)
      expect(parent.stats.greedyFinalRouteIter).toBe(0)
      expect(parent.stats.finalRoutingStrategy).toBe("greedy")
      expect(parent.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(blocked ? 0 : 1)
      expect(parent.state.regionSegments[0].length).toBe(blocked ? 1 : 2)
      const usedRegions = parent.state.regionSegments.flatMap((segments, regionId) =>
        segments.some(([routeId]) => routeId === 1) ? [regionId] : [],
      )
      expect(usedRegions).toContain(blocked ? 2 : 0)
    }
  }
  const sameOwner = createSingleLayerCompletionFixture(8, false, new Set())
  sameOwner.problem.routeNet[1] = 0
  const shared = new TinyHyperGraphSolver(sameOwner.topology, sameOwner.problem, { STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 1 })
  shared.tryFinalAcceptance()
  expect(shared.solved && !shared.failed).toBe(true)
  expect(shared.state.regionSegments[0].length).toBe(2)
  expect(shared.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(0)
})
