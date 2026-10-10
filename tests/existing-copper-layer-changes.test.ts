import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("charges no extra via or trace density for layers joined by existing copper", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([0.01]),
    regionHeight: new Float64Array([0.01]),
    regionCenterX: new Float64Array(1),
    regionCenterY: new Float64Array(1),
    regionAvailableZMask: new Int32Array([3]),
    regionConnectedZMask: new Int32Array([3]),
    portAngleForRegion1: new Int32Array([0, 18000]),
    portX: new Float64Array(2),
    portY: new Float64Array(2),
    portZ: new Int32Array([0, 1]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([0]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    VIA_COST: 1,
    TRACE_DENSITY_COST_FACTOR: 10,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteNetId = 0
  const candidate = { portId: 0, nextRegionId: 0, g: 0, h: 0, f: 0 }
  expect(solver.computeG(candidate, 1)).toBe(0)
  solver.appendSegmentToRegionCache(0, 0, 1)
  expect(
    solver.state.regionIntersectionCaches[0]?.existingEntryExitLayerChanges,
  ).toBe(0)
  expect(solver.state.regionIntersectionCaches[0]?.existingRegionCost).toBe(0)
  topology.regionConnectedZMask![0] = 1
  expect(solver.getEntryExitLayerChanges(0, 0, 1)).toBe(1)
  topology.regionConnectedZMask![0] = 0
  expect(solver.getEntryExitLayerChanges(0, 0, 1)).toBe(1)
})
