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
  pairCount: 0,
  existingCrossingLayerIntersections: 0,
  existingSameLayerIntersections: 0,
  existingEntryExitLayerChanges: 0,
  existingRegionCost,
  existingSegmentCount: 0,
})

const createTestSolver = (
  options?: ConstructorParameters<typeof TinyHyperGraphSolver>[2],
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
  }

  return new TinyHyperGraphSolver(topology, problem, options)
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

test("constructor options override snake-case hyperparameters before setup", () => {
  const solver = createTestSolver({
    DISTANCE_TO_COST: 0.25,
    RIP_THRESHOLD_START: 0.12,
    RIP_THRESHOLD_END: 0.34,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 7,
    RIP_CONGESTION_REGION_COST_FACTOR: 0.45,
    MAX_ITERATIONS: 1234,
    REGION_PAIR_CAPACITY_GROWTH_STEPS: [4, 16, 64],
  })

  expect(solver.DISTANCE_TO_COST).toBe(0.25)
  expect(solver.RIP_THRESHOLD_START).toBe(0.12)
  expect(solver.RIP_THRESHOLD_END).toBe(0.34)
  expect(solver.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(7)
  expect(solver.RIP_CONGESTION_REGION_COST_FACTOR).toBe(0.45)
  expect(solver.MAX_ITERATIONS).toBe(1234)
  expect(solver.REGION_PAIR_CAPACITY_GROWTH_STEPS).toEqual([4, 16, 64])
  expect(solver.problemSetup.portHCostToEndOfRoute[0]).toBe(0.25)
})
