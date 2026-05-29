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

const createGreedyInitializationTestSolver = (
  options?: ConstructorParameters<typeof TinyHyperGraphSolver>[2],
) => {
  const portCount = 2
  const regionCount = 3
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts: [[0], [0, 1], [1]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
    ],
    regionWidth: new Float64Array(regionCount).fill(1),
    regionHeight: new Float64Array(regionCount).fill(1),
    regionCenterX: new Float64Array(regionCount).fill(0),
    regionCenterY: new Float64Array(regionCount).fill(0),
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([1]),
    routeNet: Int32Array.from([0]),
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

test("completed routing can be accepted as best solution on timeout", () => {
  const solver = createTestSolver({ MAX_ITERATIONS: 1 })

  solver.state.unroutedRoutes = []
  solver.state.portAssignment.set([0, 0, 1, 1])
  solver.state.regionSegments[0] = [[0, 0, 1]]
  solver.state.regionSegments[1] = [[1, 2, 3]]
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.5)
  solver.state.regionIntersectionCaches[1] = createRegionCache(0.1)

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedBestSolutionOnTimeout).toBe(true)
  expect(solver.stats.bestMaxRegionCost).toBe(0.5)
  expect(solver.stats.bestTotalRegionCost).toBe(0.6)
  expect(Array.from(solver.state.portAssignment)).toEqual([0, 0, 1, 1])
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.regionSegments[1]).toEqual([[1, 2, 3]])
  expect(solver.state.regionIntersectionCaches[0].existingRegionCost).toBe(0.5)
  expect(solver.state.regionIntersectionCaches[1].existingRegionCost).toBe(0.1)
  expect(solver.state.unroutedRoutes).toEqual([])
})

test("best solution timeout acceptance can be disabled", () => {
  const solver = createTestSolver({
    MAX_ITERATIONS: 1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
  })

  solver.state.unroutedRoutes = []
  solver.state.portAssignment.set([0, 0, 1, 1])
  solver.state.regionSegments[0] = [[0, 0, 1]]
  solver.state.regionSegments[1] = [[1, 2, 3]]
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.5)
  solver.state.regionIntersectionCaches[1] = createRegionCache(0.1)

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("TinyHyperGraphSolver ran out of iterations")
  expect(solver.stats.acceptedBestSolutionOnTimeout).toBeUndefined()
  expect(Array.from(solver.state.portAssignment)).toEqual([-1, -1, -1, -1])
})

test("greedy initialization routes through normal solver steps", () => {
  const solver = createGreedyInitializationTestSolver({
    GREEDY_INITIALIZATION: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.greedyInitializationCompleted).toBe(true)
  expect(solver.stats.greedyInitializationMaxRegionCost).toBe(0)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(Array.from(solver.state.portAssignment)).toEqual([0, 0])
  expect(solver.state.regionSegments[1]).toEqual([[0, 0, 1]])
})

test("timeout acceptance does not start a hidden greedy solver", () => {
  const solver = createGreedyInitializationTestSolver({
    MAX_ITERATIONS: 1,
    GREEDY_INITIALIZATION: false,
    LATE_GREEDY_PHASE: false,
  })

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("TinyHyperGraphSolver ran out of iterations")
  expect(solver.stats.greedyInitializationCompleted).toBeUndefined()
  expect(solver.stats.acceptedBestSolutionOnTimeout).toBeUndefined()
})

test("timeout can start late greedy phase through normal solver steps", () => {
  const solver = createTestSolver({
    MAX_ITERATIONS: 10,
    LATE_GREEDY_PHASE: true,
    LATE_GREEDY_PHASE_ITERATION_BUDGET: 5,
  })

  solver.state.currentRouteId = 1
  solver.state.currentRouteNetId = 1
  solver.state.unroutedRoutes = [2]
  solver.state.goalPortId = 2
  solver.iterations = 10
  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.lateGreedyPhaseActive).toBe(true)
  expect(solver.stats.lateGreedyPhaseStarted).toBe(true)
  expect(solver.stats.lateGreedyPhaseIterationBudget).toBe(5)
  expect(solver.stats.lateGreedyPhaseRemainingRouteCount).toBe(2)
  expect(solver.MAX_ITERATIONS).toBe(15)
  expect(solver.state.currentRouteId).toBeUndefined()
  expect(solver.state.currentRouteNetId).toBeUndefined()
  expect([...solver.state.unroutedRoutes].sort((a, b) => a - b)).toEqual([1, 2])
})

test("late greedy phase accepts completed routing without another rerip", () => {
  const solver = createTestSolver()

  solver.lateGreedyPhaseActive = true
  solver.state.unroutedRoutes = []
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.5)

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.lateGreedyPhaseActive).toBe(false)
  expect(solver.lateGreedyPhaseCompleted).toBe(true)
  expect(solver.stats.acceptedLateGreedyPhaseOnTimeout).toBe(true)
  expect(solver.stats.lateGreedyPhaseMaxRegionCost).toBe(0.5)
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
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    GREEDY_INITIALIZATION: true,
    LATE_GREEDY_PHASE: true,
    LATE_GREEDY_PHASE_ITERATION_BUDGET: 4321,
  })

  expect(solver.DISTANCE_TO_COST).toBe(0.25)
  expect(solver.RIP_THRESHOLD_START).toBe(0.12)
  expect(solver.RIP_THRESHOLD_END).toBe(0.34)
  expect(solver.RIP_THRESHOLD_RAMP_ATTEMPTS).toBe(7)
  expect(solver.RIP_CONGESTION_REGION_COST_FACTOR).toBe(0.45)
  expect(solver.MAX_ITERATIONS).toBe(1234)
  expect(solver.ACCEPT_BEST_SOLUTION_ON_TIMEOUT).toBe(false)
  expect(solver.GREEDY_INITIALIZATION).toBe(true)
  expect(solver.LATE_GREEDY_PHASE).toBe(true)
  expect(solver.LATE_GREEDY_PHASE_ITERATION_BUDGET).toBe(4321)
  expect(solver.problemSetup.portHCostToEndOfRoute[0]).toBe(0.25)
})
