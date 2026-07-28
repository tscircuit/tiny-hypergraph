import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

test("counts crossings from port coordinates when a port is inside a region", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: new Float64Array([2]),
    regionHeight: new Float64Array([2]),
    regionCenterX: new Float64Array([1]),
    regionCenterY: new Float64Array([1]),
    // The second interval is nested inside the first, so boundary-angle
    // ordering alone does not classify these segments as crossing.
    portAngleForRegion1: new Int32Array([0, 3000, 1000, 2000]),
    portX: new Float64Array([0, 2, 2, 0]),
    portY: new Float64Array([0, 2, 0, 2]),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0, 2]),
    routeEndPort: new Int32Array([1, 3]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 1)
  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(0, 2, 3)

  const cache = solver.state.regionIntersectionCaches[0]
  expect(cache.existingSameLayerIntersections).toBe(1)
  expect(cache.existingCrossingLayerIntersections).toBe(0)
  expect(Array.from(cache.port1Ids ?? [])).toEqual([0, 2])
  expect(Array.from(cache.port2Ids ?? [])).toEqual([1, 3])
})

test("keeps fixed geometry in intersection caches across rerips", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([2]),
    regionHeight: new Float64Array([2]),
    regionCenterX: new Float64Array([1]),
    regionCenterY: new Float64Array([1]),
    portAngleForRegion1: new Int32Array([1000, 2000]),
    portX: new Float64Array([2, 0]),
    portY: new Float64Array([0, 2]),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([1]),
    regionNetId: new Int32Array([-1]),
    fixedRegionSegments: [
      {
        regionId: 0,
        netId: 0,
        x1: 0,
        y1: 0,
        x2: 2,
        y2: 2,
        layerMask: 1,
      },
    ],
  }
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(0, 0, 1)
  expect(
    solver.state.regionIntersectionCaches[0].existingSameLayerIntersections,
  ).toBe(1)

  solver.resetRoutingStateForRerip()
  const restoredCache = solver.state.regionIntersectionCaches[0]
  expect(restoredCache.netIds.length).toBe(1)
  expect(restoredCache.existingSameLayerIntersections).toBe(0)
  expect(Array.from(restoredCache.x1 ?? [])).toEqual([0])
  expect(Array.from(restoredCache.x2 ?? [])).toEqual([2])
})
