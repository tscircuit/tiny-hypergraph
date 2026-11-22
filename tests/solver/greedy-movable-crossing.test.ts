import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { getPreloadedSingleLayerCrossing } from "../fixtures/getPreloadedSingleLayerCrossing"

test("greedy finishing keeps crossings of movable routes available for downstream unraveling", () => {
  const { topology, problem } = getPreloadedSingleLayerCrossing()
  problem.routeIsFixed![1] = 0
  const parent = new TinyHyperGraphSolver(topology, problem)
  const solver = parent["createGreedyFinalRouteSolver"]({}, 0)
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(
    solver.state.regionIntersectionCaches.reduce(
      (sum, cache) => sum + cache.existingSameLayerIntersections,
      0,
    ),
  ).toBe(1)
})
