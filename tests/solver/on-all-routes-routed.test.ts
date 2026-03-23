import { expect, test } from "bun:test"
import {
  type Candidate,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import { MinHeap } from "lib/MinHeap"
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
  existingSegmentCount: 0,
})

const createTestSolver = (
  problemOverrides: Partial<TinyHyperGraphProblem> = {},
) => {
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
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount),
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
    regionNetId: new Int32Array(regionCount).fill(-1),
    ...problemOverrides,
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
  solver.state.candidateQueue = new MinHeap<Candidate>(
    [
      {
        nextRegionId: 0,
        portId: 1,
        f: 1,
        g: 0.5,
        h: 0.5,
      },
    ],
    (left, right) => left.f - right.f,
  )
  solver.state.goalPortId = 3

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.state.ripCount).toBe(1)
  expect(solver.state.regionCongestionCost[0]).toBeCloseTo(0.25)
  expect(solver.state.regionCongestionCost[1]).toBeCloseTo(0.15)
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
  expect(solver.state.candidateQueue.toArray()).toEqual([])
  expect(solver.state.goalPortId).toBe(-1)
})

test("completed routing is accepted once all region costs are under the threshold", () => {
  const solver = createTestSolver()

  solver.state.unroutedRoutes = []
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.02)
  solver.state.regionIntersectionCaches[1] = createRegionCache(0.01)

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.ripCount).toBe(0)
  expect(Array.from(solver.state.regionCongestionCost)).toEqual([0, 0])
})

test("computeG applies congestion falloff using remainingRoutes / totalRoutes", () => {
  const solver = createTestSolver({
    congestionCostFactor: 2,
    congestionFalloff: 0.5,
  })

  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.unroutedRoutes = [1, 2]
  solver.state.regionCongestionCost[0] = 1.2

  const g = solver.computeG(
    {
      nextRegionId: 0,
      portId: 0,
      f: 0,
      g: 1,
      h: 0,
    },
    1,
  )

  expect(g).toBeCloseTo(2.6)
})
