import { expect, test } from "bun:test"
import { createEmptyRegionIntersectionCache } from "../lib/core"
import { SharedRouteGraph } from "../lib/parallel/SharedRouteGraph"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"

test("speculative jobs are invalidated on releases, removals and congestion decreases", () => {
  const solver = createCompletionFixture()
  const graph = new SharedRouteGraph(solver)
  const initial = graph.generation
  solver.state.portAssignment[2] = 0
  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 2, 4)
  solver.state.regionCongestionCost[0] = 1
  graph.sync()
  expect(graph.generation).toBe(initial)
  solver.state.portAssignment[2] = -1
  graph.sync()
  expect(graph.generation).toBe(initial + 1)
  solver.state.regionIntersectionCaches[0] =
    createEmptyRegionIntersectionCache()
  graph.sync()
  expect(graph.generation).toBe(initial + 2)
  solver.state.regionCongestionCost[0] = 0
  graph.sync()
  expect(graph.generation).toBe(initial + 3)
})
