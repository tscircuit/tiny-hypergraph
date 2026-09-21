import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("greedy final routing moves a blocking route onto its private detour", () => {
  const solver = new SelectiveReripTinyHyperGraphSolver({
    portCount: 10,
    regionCount: 5,
    regionIncidentPorts: [[0, 2, 4, 5], [1, 3, 4, 6], [5, 6], [7, 8, 9], [8, 9]],
    incidentPortRegion: [[0], [1], [0], [1], [0, 1], [0, 2], [2, 1], [3], [3, 4], [3, 4]],
    regionWidth: new Float64Array(5).fill(4),
    regionHeight: new Float64Array(5).fill(4),
    regionCenterX: new Float64Array([0, 4, 2, 10, 14]),
    regionCenterY: new Float64Array([0, 0, 4, 0, 0]),
    regionAvailableZMask: new Int32Array(5).fill(3),
    portAngleForRegion1: new Int32Array([18000, 0, 27000, 27000, 0, 9000, 0, 18000, 0, 9000]),
    portAngleForRegion2: new Int32Array([0, 0, 0, 0, 18000, 18000, 9000, 0, 18000, 27000]),
    portX: new Float64Array([-2, 6, -1, 5, 2, 0, 4, 8, 12, 10]),
    portY: new Float64Array([0, 0, -2, -2, 0, 2, 2, 0, 0, 2]),
    portZ: new Int32Array(10),
  }, {
    routeCount: 3,
    portSectionMask: new Int8Array(10).fill(1),
    routeStartPort: new Int32Array([0, 2, 7]),
    routeEndPort: new Int32Array([1, 3, 8]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([-1, -1, 0, -1, -1]),
  }, {
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 1,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.portAssignment.set([0, 0, -1, -1, 0, -1, -1, 2, 2, 2])
  solver.state.regionSegments[0] = [[0, 0, 4]]
  solver.state.regionSegments[1] = [[0, 4, 1]]
  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 4)
  solver.appendSegmentToRegionCache(1, 4, 1)
  // A committed route elsewhere must not be discarded to free this blocker.
  solver.state.regionSegments[3] = [[2, 7, 9]]
  solver.state.regionSegments[4] = [[2, 9, 8]]
  solver.state.currentRouteNetId = 2
  solver.appendSegmentToRegionCache(3, 7, 9)
  solver.appendSegmentToRegionCache(4, 9, 8)
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = [1]

  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
  expect(solver.state.portAssignment[4]).toBe(1)
  expect(solver.state.regionSegments[2]).toEqual([[0, 5, 6]])
  expect(solver.state.regionSegments[3]).toEqual([[2, 7, 9]])
  expect(solver.state.regionSegments[4]).toEqual([[2, 9, 8]])
  expect(solver.state.unroutedRoutes).toEqual([])
})
