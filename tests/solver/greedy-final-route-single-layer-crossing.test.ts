import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"

test("greedy completion rejects an unavoidable crossing on a single layer", () => {
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 5,
      regionCount: 5,
      regionIncidentPorts: [[0, 1, 2, 3], [0], [1], [2], [3, 4]],
      incidentPortRegion: [[1, 0], [0, 2], [3, 0], [0, 4], [4]],
      regionWidth: new Float64Array(5).fill(2),
      regionHeight: new Float64Array(5).fill(2),
      regionCenterX: new Float64Array([0, -2, 2, 0, 0]),
      regionCenterY: new Float64Array([0, 0, 0, -2, 2]),
      regionAvailableZMask: new Int32Array(5).fill(1),
      portAngleForRegion1: new Int32Array([0, 0, 9000, 9000, 9000]),
      portAngleForRegion2: new Int32Array([18000, 18000, 27000, 27000, 0]),
      portX: new Float64Array([-1, 1, 0, 0, 0]),
      portY: new Float64Array([0, 0, -1, 1, 3]),
      portZ: new Int32Array(5),
    },
    {
      routeCount: 2,
      portSectionMask: new Int8Array(5).fill(1),
      routeStartPort: new Int32Array([0, 2]),
      routeEndPort: new Int32Array([1, 4]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array([-1, 0, 0, 1, 1]),
    },
    {
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      GREEDY_FINAL_ROUTE_ITERS: 1,
      STATIC_REACHABILITY_PRECHECK: false,
      MAX_ITERATIONS: 100,
    },
  )
  solver.state.portAssignment.set([0, 0, -1, -1, -1])
  solver.state.regionSegments[0] = [[0, 0, 1]]
  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 1)
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = [1]
  solver.state.ripCount = 8

  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(false)
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
})
