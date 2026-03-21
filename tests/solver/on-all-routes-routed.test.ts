import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { RegionIntersectionCache } from "lib/types"

const createRegionCache = (
  existingRegionCost: number,
): RegionIntersectionCache => ({
  netIds: new Int32Array(0),
  lesserAngles: new Int32Array(0),
  greaterAngles: new Int32Array(0),
  layerMasks: new Int32Array(0),
  existingCrossingLayerIntersections: 0,
  existingSameLayerIntersections: 0,
  existingEntryExitLayerChanges: 0,
  existingRegionCost,
})

const createTestSolver = () => {
  const portCount = 4
  const regionCount = 2
  const routeCount = 3

  const routeStartPort = new Int32Array(routeCount)
  const routeEndPort = new Int32Array(routeCount)
  const routeNet = new Int32Array(routeCount)
  for (let routeId = 0; routeId < routeCount; routeId++) {
    routeStartPort[routeId] = routeId
    routeEndPort[routeId] = (routeId + 1) % portCount
    routeNet[routeId] = routeId
  }

  const portX = new Float64Array(portCount)
  for (let portId = 0; portId < portCount; portId++) {
    portX[portId] = portId
  }

  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts: Array.from({ length: regionCount }, () => []),
    incidentPortRegion: Array.from({ length: portCount }, () => [0, 1]),
    regionWidth: new Float64Array(regionCount).fill(1),
    regionHeight: new Float64Array(regionCount).fill(1),
    regionCenterX: new Float64Array(regionCount).fill(0),
    regionCenterY: new Float64Array(regionCount).fill(0),
    portAngle: new Int32Array(portCount),
    portX,
    portY: new Float64Array(portCount).fill(0),
    portZ: new Int32Array(portCount),
  }

  const problem: TinyHyperGraphProblem = {
    routeCount,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort,
    routeEndPort,
    routeNet,
  }

  return new TinyHyperGraphSolver(topology, problem)
}

test("completed routing rerips when a region exceeds the current threshold", () => {
  const solver = createTestSolver()

  solver.state.unroutedRoutes = []
  solver.state.portAssignment.set([0, 0, 1, 1])
  solver.state.regionSegments[0] = [[0, 0, 1]]
  solver.state.regionSegments[1] = [[1, 2, 3]]
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.5)
  solver.state.regionIntersectionCaches[1] = createRegionCache(0.1)
  solver.state.regionCongestionCost[1] = 0.2
  solver.state.visitedSegments.add(3)
  solver.state.candidates = [
    {
      nextRegionId: 0,
      portId: 1,
      segmentId: 1,
      f: 1,
      g: 0.5,
      h: 0.5,
    },
  ]
  solver.state.goalPortId = 3

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.state.ripCount).toBe(1)
  expect(solver.state.regionCongestionCost[0]).toBe(
    0.5 * solver.RIP_CONGESTION_REGION_COST_FACTOR,
  )
  expect(solver.state.regionCongestionCost[1]).toBe(
    0.2 + 0.1 * solver.RIP_CONGESTION_REGION_COST_FACTOR,
  )
  expect(Array.from(solver.state.portAssignment)).toEqual([-1, -1, -1, -1])
  expect(
    solver.state.regionSegments.map((segments) => segments.length),
  ).toEqual([0, 0])
  expect(
    solver.state.regionIntersectionCaches.map(
      (cache) => cache.existingRegionCost,
    ),
  ).toEqual([0, 0])
  expect(Array.from(solver.state.unroutedRoutes).sort((a, b) => a - b)).toEqual(
    [0, 1, 2],
  )
  expect(solver.state.currentRouteId).toBeUndefined()
  expect(solver.state.currentRouteNetId).toBeUndefined()
  expect(solver.state.visitedSegments.size).toBe(0)
  expect(solver.state.candidates).toEqual([])
  expect(solver.state.goalPortId).toBe(-1)
})

test("completed routing is accepted once all region costs are under the threshold", () => {
  const solver = createTestSolver()

  solver.state.unroutedRoutes = []
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.2)
  solver.state.regionIntersectionCaches[1] = createRegionCache(0.1)

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.ripCount).toBe(0)
  expect(Array.from(solver.state.regionCongestionCost)).toEqual([0, 0])
})
