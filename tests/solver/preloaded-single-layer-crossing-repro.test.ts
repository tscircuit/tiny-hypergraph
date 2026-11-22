import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { TinyHyperGraphSolver } from "lib/core"
import { getPreloadedSingleLayerCrossing } from "../fixtures/getPreloadedSingleLayerCrossing"

test("replays the greedy route beside preloaded copper from a captured circuit", () => {
  const { topology, problem } = getPreloadedSingleLayerCrossing()
  const options = { OWNED_REGIONAL_HOP_FRONTIER: true }
  const parent = new TinyHyperGraphSolver(topology, problem, options)
  const solver = parent["createGreedyFinalRouteSolver"](options, 0)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(
    solver.state.regionIntersectionCaches.reduce(
      (sum, cache) => sum + cache.existingSameLayerIntersections,
      0,
    ),
  ).toBe(0)
  for (const segment of problem.initialAssignments!) {
    expect(solver.state.regionSegments[segment.regionId]).toContainEqual([
      segment.routeId,
      segment.fromPortId,
      segment.toPortId,
    ])
  }
  expect(
    getSvgFromGraphicsObject(solver.preview(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
