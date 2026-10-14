import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

// Extracted from PMP22650 region topology_merge_1185 in dataset-srj24
// sample024. The two different-net segments interleave in a top-only region.
const pmp22650CrossingRegionTopology: TinyHyperGraphTopology = {
  portCount: 4,
  regionCount: 1,
  regionIncidentPorts: [[0, 1, 2, 3]],
  incidentPortRegion: [[0], [0], [0], [0]],
  regionWidth: new Float64Array([0.29719904999998903]),
  regionHeight: new Float64Array([0.4466009800000279]),
  regionCenterX: new Float64Array([70.310199105]),
  regionCenterY: new Float64Array([98.84669948999999]),
  regionAvailableZMask: new Int32Array([1 << 0]),
  portAngleForRegion1: new Int32Array([22500, 34810, 4500, 30310]),
  portAngleForRegion2: new Int32Array(4),
  portX: new Float64Array([
    70.16159958, 70.41949847999999, 70.45879862999999, 70.27089895499999,
  ]),
  portY: new Float64Array([
    98.84669948999999, 98.62339919999998, 98.84669968999998,
    98.62339899999998,
  ]),
  portZ: new Int32Array(4),
}

test("PMP22650 greedy timeout recovery accepts a single-layer crossing", () => {
  const solver = new TinyHyperGraphSolver(
    pmp22650CrossingRegionTopology,
    {
      routeCount: 2,
      portSectionMask: new Int8Array(4).fill(1),
      routeStartPort: new Int32Array([0, 2]),
      routeEndPort: new Int32Array([1, 3]),
      routeNet: new Int32Array([24, 257]),
      regionNetId: new Int32Array([-1]),
    },
    {
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      GREEDY_FINAL_ROUTE_ITERS: 1,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )
  solver.state.portAssignment.set([24, 24, -1, -1])
  solver.state.regionSegments[0] = [[0, 0, 1]]
  solver.state.currentRouteNetId = 24
  solver.appendSegmentToRegionCache(0, 0, 1)
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = [1]

  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(
    solver.state.regionIntersectionCaches[0].existingSameLayerIntersections,
  ).toBe(1)
  expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "#0d1b2a",
      svgWidth: 900,
      svgHeight: 600,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
