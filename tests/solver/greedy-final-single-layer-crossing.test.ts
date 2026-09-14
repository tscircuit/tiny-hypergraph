import { expect, test } from "bun:test"
import { createCrossingFinalHopSolver } from "../fixtures/createCrossingFinalHopSolver"

test("greedy final acceptance rejects different-net crossings on every single layer while permitting legal shared-net and multilayer paths", () => {
  for (const layer of [0, 1, 2, 3]) {
    for (const crossingKind of [
      "single_layer",
      "same_net",
      "multilayer",
    ] as const) {
      const solver = createCrossingFinalHopSolver({ layer, crossingKind })
      expect(solver.state.unroutedRoutes).toEqual([1])
      solver.tryFinalAcceptance()

      if (crossingKind === "single_layer") {
        expect(solver.solved).toBe(false)
        expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBeUndefined()
        expect(solver.state.unroutedRoutes).toEqual([1])
        expect(solver.state.regionSegments[0]).toEqual([[0, 0, 2]])
      } else {
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
        expect(solver.state.unroutedRoutes).toEqual([])
        expect(solver.state.regionSegments[0]).toEqual([
          [0, 0, 2],
          [1, 1, 3],
        ])
      }
    }
  }
})
