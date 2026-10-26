import { expect, test } from "bun:test"
import {
  applyTinyHyperGraphSolverOptions,
  getTinyHyperGraphSolverOptions,
} from "../lib/core"
import { computeRegionCost } from "../lib/computeRegionCost"
import {
  createRegionCostProbeGraph,
  RegionCostProbe,
} from "./fixtures/region-cost-lookup"

test("region score lookup refreshes after policy geometry occupancy and restore changes", (): void => {
  const graph = createRegionCostProbeGraph()
  const solver = new RegionCostProbe(graph.topology, graph.problem, {
    USE_REGION_COST_LOOKUP: true,
  })
  const verify = (): void => {
    const c = solver.state.regionIntersectionCaches[0]
    const expected = computeRegionCost(
      graph.topology.regionWidth[0],
      graph.topology.regionHeight[0],
      c.existingSameLayerIntersections,
      c.existingCrossingLayerIntersections + 1,
      c.existingEntryExitLayerChanges,
      c.existingSegmentCount + 1,
      graph.topology.regionAvailableZMask![0],
      solver.minViaPadDiameter,
      solver.TRACE_DENSITY_COST_FACTOR,
    )
    expect(Object.is(solver.score(0, 1, 0), expected)).toBe(true)
  }
  verify()
  for (const width of [0, -0, 1, Number.POSITIVE_INFINITY, 0.125]) {
    graph.topology.regionWidth[0] = width
    verify()
  }
  graph.topology.regionHeight[0] = 0.3
  graph.topology.regionAvailableZMask![0] = 7
  applyTinyHyperGraphSolverOptions(solver, {
    minViaPadDiameter: 0.77,
    TRACE_DENSITY_COST_FACTOR: 0.25,
  })
  verify()
  const replay = new RegionCostProbe(
    graph.topology,
    graph.problem,
    getTinyHyperGraphSolverOptions(solver),
  )
  expect(replay.USE_REGION_COST_LOOKUP).toBe(true)
  expect(Object.is(replay.score(0, 1, 0), solver.score(0, 1, 0))).toBe(true)
  const c = solver.state.regionIntersectionCaches[0]
  c.existingCrossingLayerIntersections = 4
  c.existingSameLayerIntersections = 2
  c.existingEntryExitLayerChanges = 3
  c.existingSegmentCount = 7
  verify()
  solver.state.regionIntersectionCaches[0] = { ...c }
  verify()
  solver.restoreRecordedState()
  verify()
  solver.resetRoutingStateForRerip()
  verify()
  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(0, 0, 1)
  verify()
})
