import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { RouteSnapshot } from "../lib/parallel/RouteSnapshot"
import { SharedRouteGraph } from "../lib/parallel/SharedRouteGraph"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"

test("shared region views retain read versions across mutations and refresh only visited regions", () => {
  const source = createCompletionFixture()
  const graph = new SharedRouteGraph(source)
  const target = new DistanceAwareTinyHyperGraphSolver(
    source.topology,
    source.problem,
    { STATIC_REACHABILITY_PRECHECK: false },
  )
  const snapshot = new RouteSnapshot(target, graph.context)
  snapshot.read(0)
  const first = target.state.regionIntersectionCaches[0]!
  expect(first.netIds.buffer).toBe(graph.context.storage.buffer)
  expect(target.state.portAssignment).toBe(graph.context.assignment)
  expect(target.state.regionCongestionCost).toBe(graph.context.congestion)
  expect(first).toEqual(source.state.regionIntersectionCaches[0])
  expect(snapshot.versions[1]).toBe(-1)
  snapshot.read(0)
  expect(target.state.regionIntersectionCaches[0]).toBe(first)

  const originalVersion = snapshot.versions[0]
  source.state.regionCongestionCost[0] += 2
  source.state.portAssignment[4] = 1
  graph.sync()
  // Shared values can change during a speculative search. Its old read version
  // must remain unchanged so coordinator validation rejects that result.
  expect(snapshot.versions[0]).toBe(originalVersion)
  expect(snapshot.versions[0]).not.toBe(graph.context.headers[0])
  expect(target.state.regionCongestionCost[0]).toBe(2)
  expect(target.state.portAssignment[4]).toBe(1)
  snapshot.read(0)
  expect(snapshot.versions[0]).toBe(graph.context.headers[0])
  expect(snapshot.versions[1]).toBe(-1)

  source.state.currentRouteNetId = 1
  source.appendSegmentToRegionCache(0, 2, 5)
  graph.sync()
  const beforeGrowth = snapshot.versions[0]
  expect(beforeGrowth).not.toBe(graph.context.headers[0])
  snapshot.read(0)
  expect(target.state.regionIntersectionCaches[0]).toEqual(
    source.state.regionIntersectionCaches[0],
  )
  expect(snapshot.versions[0]).toBe(graph.context.headers[0])
  expect(target.state.regionIntersectionCaches[0]!.netIds.length).toBe(2)
  snapshot.read(1)
  expect(target.state.regionIntersectionCaches[1]).toEqual(
    source.state.regionIntersectionCaches[1],
  )
})
