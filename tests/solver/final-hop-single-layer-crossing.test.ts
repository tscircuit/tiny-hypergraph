import { expect, test } from "bun:test"
import { createCrossingFinalHopSolver } from "../fixtures/createCrossingFinalHopSolver"

test("normal routing checks the final hop before accepting a path", () => {
  for (const layer of [0, 1, 2, 3]) {
    const solver = createCrossingFinalHopSolver({
      layer,
      crossingKind: "single_layer",
      options: {
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        MAX_ITERATIONS: 100,
      },
    })
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(
      solver.state.regionIntersectionCaches[0].existingSameLayerIntersections,
    ).toBe(0)
  }
})
