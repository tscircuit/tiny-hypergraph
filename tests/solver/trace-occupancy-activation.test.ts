import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib"

test("trace occupancy activates only after a complete baseline exists", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 0,
    regionCount: 1,
    regionIncidentPorts: [[]],
    incidentPortRegion: [],
    regionWidth: new Float64Array([2]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([1]),
    regionCenterY: new Float64Array([0.5]),
    portAngleForRegion1: new Int32Array(0),
    portX: new Float64Array(0),
    portY: new Float64Array(0),
    portZ: new Int32Array(0),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 0,
    portSectionMask: new Int8Array(0),
    routeStartPort: new Int32Array(0),
    routeEndPort: new Int32Array(0),
    routeNet: new Int32Array(0),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_START: 1,
  })
  const regionCache = solver.state.regionIntersectionCaches[0]!
  regionCache.traceLengthByLayer[0] = 7
  regionCache.longestTraceLengthByLayer[0] = 4

  expect(regionCache.existingRegionCost).toBe(0)
  solver.onAllRoutesRouted()
  expect(regionCache.existingRegionCost).toBeCloseTo(0.09)
  expect(solver.solved).toBe(true)
})
