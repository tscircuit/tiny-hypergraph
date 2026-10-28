import { expect, test } from "bun:test"
import { PolyHyperGraphSolver } from "lib/poly"
import type {
  PolyHyperGraphProblem,
  PolyHyperGraphTopology,
} from "lib/poly-types"

test("poly candidate scoring retains topology angles when segment geometry uses boundary coordinates", (): void => {
  const topology: PolyHyperGraphTopology = {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: Float64Array.of(1),
    regionHeight: Float64Array.of(1),
    regionCenterX: Float64Array.of(0.5),
    regionCenterY: Float64Array.of(0.5),
    portAngleForRegion1: Int32Array.of(31500, 31739, 31997, 13500),
    portX: Float64Array.of(1, 1, 1, 0),
    portY: Float64Array.of(0, 0.04, 0.08, 1),
    portZ: new Int32Array(4),
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
    portBoundaryPositionForRegion1: Int32Array.of(0, 360, 720, 18000),
    portBoundaryPositionForRegion2: new Int32Array(4),
    portEdgeIndexForRegion1: Int32Array.of(0, 0, 0, 2),
    portEdgeIndexForRegion2: new Int32Array(4),
    portEdgeTForRegion1: Float64Array.of(0, 0.04, 0.08, 0),
    portEdgeTForRegion2: new Float64Array(4),
  }
  const problem: PolyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: Int8Array.of(1, 1, 1, 1),
    routeStartPort: Int32Array.of(1),
    routeEndPort: Int32Array.of(3),
    routeNet: Int32Array.of(2),
    regionNetId: Int32Array.of(-1),
  }
  const solver = new PolyHyperGraphSolver(topology, problem)
  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(0, 0, 2)
  expect(solver.state.regionIntersectionCaches[0]!.lesserAngles[0]).toBe(0)
  expect(solver.state.regionIntersectionCaches[0]!.greaterAngles[0]).toBe(720)

  solver.state.currentRouteNetId = 2
  expect(
    solver.computeG({ portId: 1, nextRegionId: 0, g: 0, h: 0, f: 0 }, 3),
  ).toBe(0)
})
