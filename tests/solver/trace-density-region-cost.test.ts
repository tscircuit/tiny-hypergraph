import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const createProblem = (portCount: number): TinyHyperGraphProblem => ({
  routeCount: 3,
  portSectionMask: new Int8Array(portCount).fill(1),
  routeStartPort: new Int32Array([0, 2, 4]),
  routeEndPort: new Int32Array([1, 3, 5]),
  routeNet: new Int32Array([0, 1, 2]),
  regionNetId: new Int32Array(2).fill(-1),
})

const createSingleRegionTopology = (): TinyHyperGraphTopology => ({
  portCount: 8,
  regionCount: 1,
  regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7]],
  incidentPortRegion: Array.from({ length: 8 }, () => [0]),
  regionWidth: new Float64Array([0.1]),
  regionHeight: new Float64Array([2]),
  regionCenterX: new Float64Array([0]),
  regionCenterY: new Float64Array([0]),
  regionAvailableZMask: new Int32Array([3]),
  portAngleForRegion1: new Int32Array([
    0, 1000, 2000, 3000, 4000, 5000, 6000, 7000,
  ]),
  portX: new Float64Array(8),
  portY: new Float64Array(8),
  portZ: new Int32Array([0, 0, 0, 0, 1, 1, 0, 0]),
})

test("trace density counts distinct nets only on shared layers", () => {
  const solver = new TinyHyperGraphSolver(
    createSingleRegionTopology(),
    createProblem(8),
  )

  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 1)
  solver.appendSegmentToRegionCache(0, 2, 3)

  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(0, 4, 5)
  expect(solver.state.regionIntersectionCaches[0].existingRegionCost).toBe(0)

  solver.state.currentRouteNetId = 2
  const candidateCost = solver.computeG(
    { nextRegionId: 0, portId: 6, f: 0, g: 0, h: 0 },
    7,
  )
  expect(candidateCost).toBeCloseTo(4)

  solver.appendSegmentToRegionCache(0, 6, 7)
  expect(
    solver.state.regionIntersectionCaches[0].existingRegionCost,
  ).toBeCloseTo(candidateCost)
})

test("trace density prefers wider regions for an additional net", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 8,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
    incidentPortRegion: [[0], [0], [0], [0], [1], [1], [1], [1]],
    regionWidth: new Float64Array([0.2, 2]),
    regionHeight: new Float64Array([3, 3]),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: new Int32Array([1, 1]),
    portAngleForRegion1: new Int32Array([
      0, 1000, 2000, 3000, 0, 1000, 2000, 3000,
    ]),
    portX: new Float64Array(8),
    portY: new Float64Array(8),
    portZ: new Int32Array(8),
  }
  const solver = new TinyHyperGraphSolver(topology, createProblem(8), {
    minTraceWidth: 0.2,
    minTraceClearance: 0.1,
  })

  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 1)
  solver.appendSegmentToRegionCache(1, 4, 5)

  solver.state.currentRouteNetId = 1
  const narrowRegionCost = solver.computeG(
    { nextRegionId: 0, portId: 2, f: 0, g: 0, h: 0 },
    3,
  )
  const wideRegionCost = solver.computeG(
    { nextRegionId: 1, portId: 6, f: 0, g: 0, h: 0 },
    7,
  )

  expect(narrowRegionCost).toBeCloseTo(2.25)
  expect(wideRegionCost).toBeCloseTo(0.0225)
  expect(narrowRegionCost).toBeGreaterThan(wideRegionCost)
})
