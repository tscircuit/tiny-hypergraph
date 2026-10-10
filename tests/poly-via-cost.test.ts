import { expect, test } from "bun:test"
import { PolyHyperGraphSolver } from "lib/poly"
import type {
  PolyHyperGraphProblem,
  PolyHyperGraphTopology,
} from "lib/poly-types"

test("poly routing applies fixed via cost using polygon area for congestion", (): void => {
  const topology: PolyHyperGraphTopology = {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: Float64Array.of(3),
    regionHeight: Float64Array.of(3),
    regionCenterX: Float64Array.of(0.5),
    regionCenterY: Float64Array.of(0.5),
    regionAvailableZMask: Int32Array.of(3),
    portAngleForRegion1: Int32Array.of(0, 9000, 18000, 27000),
    portX: Float64Array.of(1, 0.5, 0, 0.5),
    portY: Float64Array.of(0.5, 1, 0.5, 0),
    portZ: Int32Array.of(0, 1, 0, 1),
    regionVertexStart: Int32Array.of(0),
    regionVertexCount: Int32Array.of(4),
    regionVertexX: Float64Array.of(1, 1, 0, 0),
    regionVertexY: Float64Array.of(0, 1, 1, 0),
    regionArea: Float64Array.of(1),
    regionPerimeter: Float64Array.of(4),
    regionBoundsMinX: Float64Array.of(0),
    regionBoundsMaxX: Float64Array.of(1),
    regionBoundsMinY: Float64Array.of(0),
    regionBoundsMaxY: Float64Array.of(1),
    portBoundaryPositionForRegion1: Int32Array.of(0, 9000, 18000, 27000),
    portBoundaryPositionForRegion2: new Int32Array(4),
    portEdgeIndexForRegion1: Int32Array.of(0, 1, 2, 3),
    portEdgeIndexForRegion2: new Int32Array(4),
    portEdgeTForRegion1: new Float64Array(4).fill(0.5),
    portEdgeTForRegion2: new Float64Array(4),
  }
  const problem: PolyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: Int32Array.of(0, 1),
    routeEndPort: Int32Array.of(2, 3),
    routeNet: Int32Array.of(0, 1),
    regionNetId: Int32Array.of(-1),
  }
  const solver = new PolyHyperGraphSolver(topology, problem, {
    CROSS_LAYER_INTERSECTION_COST_FACTOR: 0,
    VIA_COST: 0.3,
  })
  solver.state.currentRouteNetId = 0
  expect(
    solver.computeG({ nextRegionId: 0, portId: 0, f: 0, g: 0, h: 0 }, 1),
  ).toBeCloseTo(0.543)
  solver.appendSegmentToRegionCache(0, 0, 1)
  expect(
    solver.state.regionIntersectionCaches[0].existingRegionCost,
  ).toBeCloseTo(0.543)

  const crossing = new PolyHyperGraphSolver(topology, problem, {
    CROSS_LAYER_INTERSECTION_COST_FACTOR: 0,
    VIA_COST: 0.3,
  })
  crossing.state.currentRouteNetId = 0
  crossing.appendSegmentToRegionCache(0, 0, 2)
  crossing.state.currentRouteNetId = 1
  expect(
    crossing.computeG({ nextRegionId: 0, portId: 1, f: 0, g: 0, h: 0 }, 3),
  ).toBe(0)
})
