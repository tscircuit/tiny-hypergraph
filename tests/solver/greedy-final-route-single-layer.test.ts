import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "lib/core"

test("greedy final acceptance cannot publish a crossing on the final hop of a single-layer region", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3], []],
    incidentPortRegion: [[0, 1], [0, 1], [0, 1], [0, 1]],
    regionWidth: new Float64Array([3, 1]),
    regionHeight: new Float64Array([3, 1]),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: new Int32Array([1 << 5, 0]),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([1, 0, -1, 0]),
    portY: new Float64Array([0, 1, 0, -1]),
    portZ: new Int32Array(4).fill(5),
  }
  const solver = new TinyHyperGraphSolver(topology, {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([2, 3]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(2).fill(-1),
  }, {
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 1,
  })
  solver.state.portAssignment.set([0, -1, 0, -1])
  solver.state.regionSegments[0] = [[0, 0, 2]]
  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 2)
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = [1]

  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(false)
  expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).not.toBe(true)
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 2]])
  expect(solver.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(0)
})
