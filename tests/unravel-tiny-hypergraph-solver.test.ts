import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  UnravelTinyHyperGraphSolver,
} from "lib/index"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "lib/section-solver"
import type { PortId, RegionId, RouteId } from "lib/types"

const createCrossedSolvedSolver = (portZ = new Int32Array(6)) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 4,
    regionIncidentPorts: [
      [0, 1, 2, 3],
      [2, 3, 4, 5],
      [0, 1],
      [4, 5],
    ],
    incidentPortRegion: [
      [0, 2],
      [0, 2],
      [0, 1],
      [0, 1],
      [1, 3],
      [1, 3],
    ],
    regionWidth: new Float64Array(4).fill(1),
    regionHeight: new Float64Array(4).fill(1),
    regionCenterX: new Float64Array([0, 1, -1, 2]),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000, 18000, 27000]),
    portAngleForRegion2: new Int32Array([0, 9000, 0, 9000, 0, 9000]),
    portX: new Float64Array([-1, -1, 0.5, 0.5, 2, 2]),
    // The two routes cross geometrically at the shared boundary: exchanging
    // ports 2 and 3 both removes the angular crossing and shortens the paths.
    portY: new Float64Array([1, -1, -1, 1, 1, -1]),
    portZ,
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([4, 5]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(4).fill(-1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)
  const addSegment = (
    regionId: RegionId,
    routeId: RouteId,
    fromPortId: PortId,
    toPortId: PortId,
  ) => {
    const routeNetId = problem.routeNet[routeId]!
    solver.state.currentRouteNetId = routeNetId
    solver.state.regionSegments[regionId]!.push([routeId, fromPortId, toPortId])
    solver.state.portAssignment[fromPortId] = routeNetId
    solver.state.portAssignment[toPortId] = routeNetId
    solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
  }

  addSegment(0, 0, 0, 2)
  addSegment(1, 0, 2, 4)
  addSegment(0, 1, 1, 3)
  addSegment(1, 1, 3, 5)
  solver.state.currentRouteNetId = undefined
  solver.solved = true

  return solver
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, cache) => Math.max(maxCost, cache.existingRegionCost),
    0,
  )

const getTotalSegmentCount = (solver: TinyHyperGraphSolver) =>
  solver.state.regionSegments.reduce(
    (total, segments) => total + segments.length,
    0,
  )

const createSolvedSolverWithAlternatePath = () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 13,
    regionCount: 13,
    regionIncidentPorts: [
      [0, 1, 3],
      [1, 2, 8, 9],
      [2, 5, 6],
      [3, 4, 11, 12],
      [4, 5],
      [7, 8],
      [9, 10],
      [0],
      [6],
      [7],
      [10],
      [11],
      [12],
    ],
    incidentPortRegion: [
      [0, 7],
      [0, 1],
      [1, 2],
      [0, 3],
      [3, 4],
      [4, 2],
      [2, 8],
      [5, 9],
      [5, 1],
      [1, 6],
      [6, 10],
      [3, 11],
      [3, 12],
    ],
    regionWidth: new Float64Array(13).fill(1),
    regionHeight: new Float64Array(13).fill(1),
    regionCenterX: new Float64Array(13),
    regionCenterY: new Float64Array(13),
    portAngleForRegion1: new Int32Array([
      0, 9000, 18000, 18000, 0, 0, 18000, 0, 9000, 27000, 18000, 9000, 9000,
    ]),
    portAngleForRegion2: new Int32Array([
      0, 0, 0, 0, 18000, 9000, 0, 0, 9000, 0, 0, 0, 0,
    ]),
    portX: new Float64Array(13),
    portY: new Float64Array(13),
    portZ: new Int32Array(13),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(13).fill(1),
    routeStartPort: new Int32Array([0, 7, 11]),
    routeEndPort: new Int32Array([6, 10, 12]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array(13).fill(-1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)
  const addSegment = (
    regionId: RegionId,
    routeId: RouteId,
    fromPortId: PortId,
    toPortId: PortId,
  ) => {
    const routeNetId = problem.routeNet[routeId]!
    solver.state.currentRouteNetId = routeNetId
    solver.state.regionSegments[regionId]!.push([routeId, fromPortId, toPortId])
    solver.state.portAssignment[fromPortId] = routeNetId
    solver.state.portAssignment[toPortId] = routeNetId
    solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
  }

  addSegment(0, 0, 0, 1)
  addSegment(1, 0, 1, 2)
  addSegment(2, 0, 2, 6)
  addSegment(5, 1, 7, 8)
  addSegment(1, 1, 8, 9)
  addSegment(6, 1, 9, 10)
  addSegment(3, 2, 11, 12)
  solver.state.currentRouteNetId = undefined
  solver.solved = true

  return solver
}

const duplicateSolvedSolver = (
  source: TinyHyperGraphSolver,
  coordinateOffset = 100,
) => {
  const portCount = source.topology.portCount * 2
  const regionCount = source.topology.regionCount * 2
  const routeCount = source.problem.routeCount * 2
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts: [0, 1].flatMap((copyIndex) =>
      source.topology.regionIncidentPorts.map((portIds) =>
        portIds.map((portId) => portId + copyIndex * source.topology.portCount),
      ),
    ),
    incidentPortRegion: [0, 1].flatMap((copyIndex) =>
      source.topology.incidentPortRegion.map((regionIds) =>
        regionIds.map(
          (regionId) => regionId + copyIndex * source.topology.regionCount,
        ),
      ),
    ),
    regionWidth: new Float64Array([
      ...source.topology.regionWidth,
      ...source.topology.regionWidth,
    ]),
    regionHeight: new Float64Array([
      ...source.topology.regionHeight,
      ...source.topology.regionHeight,
    ]),
    regionCenterX: new Float64Array([
      ...source.topology.regionCenterX,
      ...Array.from(source.topology.regionCenterX, (x) => x + coordinateOffset),
    ]),
    regionCenterY: new Float64Array([
      ...source.topology.regionCenterY,
      ...source.topology.regionCenterY,
    ]),
    portAngleForRegion1: new Int32Array([
      ...source.topology.portAngleForRegion1,
      ...source.topology.portAngleForRegion1,
    ]),
    portAngleForRegion2: new Int32Array([
      ...source.topology.portAngleForRegion2!,
      ...source.topology.portAngleForRegion2!,
    ]),
    portX: new Float64Array([
      ...source.topology.portX,
      ...Array.from(source.topology.portX, (x) => x + coordinateOffset),
    ]),
    portY: new Float64Array([
      ...source.topology.portY,
      ...source.topology.portY,
    ]),
    portZ: new Int32Array([...source.topology.portZ, ...source.topology.portZ]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: new Int32Array([
      ...source.problem.routeStartPort,
      ...Array.from(
        source.problem.routeStartPort,
        (portId) => portId + source.topology.portCount,
      ),
    ]),
    routeEndPort: new Int32Array([
      ...source.problem.routeEndPort,
      ...Array.from(
        source.problem.routeEndPort,
        (portId) => portId + source.topology.portCount,
      ),
    ]),
    routeNet: new Int32Array(Array.from({ length: routeCount }, (_, id) => id)),
    regionNetId: new Int32Array(regionCount).fill(-1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)
  for (let copyIndex = 0; copyIndex < 2; copyIndex++) {
    for (
      let sourceRegionId = 0;
      sourceRegionId < source.topology.regionCount;
      sourceRegionId++
    ) {
      for (const [sourceRouteId, sourceFromPortId, sourceToPortId] of source
        .state.regionSegments[sourceRegionId]!) {
        const routeId = sourceRouteId + copyIndex * source.problem.routeCount
        const regionId =
          sourceRegionId + copyIndex * source.topology.regionCount
        const fromPortId =
          sourceFromPortId + copyIndex * source.topology.portCount
        const toPortId = sourceToPortId + copyIndex * source.topology.portCount
        const routeNetId = problem.routeNet[routeId]!
        solver.state.currentRouteId = routeId
        solver.state.currentRouteNetId = routeNetId
        solver.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        solver.state.portAssignment[fromPortId] = routeNetId
        solver.state.portAssignment[toPortId] = routeNetId
        solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
  }
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.solved = true
  return solver
}

const createSolvedSolverWithIndependentAlternatePaths = () =>
  duplicateSolvedSolver(createSolvedSolverWithAlternatePath())

const createSolvedSolverRequiringPairedReroutes = () => {
  const solver = createSolvedSolverWithIndependentAlternatePaths()
  const copyPortCount = solver.topology.portCount / 2
  const localPortX = [0, 1, 2, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1]
  const localPortY = [0, 0, 0, 10, 10, 10, 0, -10, -10, -10, -10, 20, 20]
  for (let copyIndex = 0; copyIndex < 2; copyIndex++) {
    for (let localPortId = 0; localPortId < copyPortCount; localPortId++) {
      const portId = localPortId + copyIndex * copyPortCount
      solver.topology.portX[portId] = localPortX[localPortId]! + copyIndex * 100
      solver.topology.portY[portId] = localPortY[localPortId]!
    }
  }
  return solver
}

const createSolvedSolverWithSharedDownstreamConnection = () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5]],
    incidentPortRegion: Array.from({ length: 6 }, () => [0]),
    regionWidth: new Float64Array([10]),
    regionHeight: new Float64Array([10]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array([0, 18000, 9000, 27000, 4500, 22500]),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([1, -1, 0, 0, 1, -1]),
    portY: new Float64Array([0, 0, 1, -1, 1, -1]),
    portZ: new Int32Array(6),
    regionAvailableZMask: new Int32Array([3]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    routeMetadata: [
      { simpleRouteConnection: { name: "connection-a" } },
      { simpleRouteConnection: { name: "connection-a" } },
      { simpleRouteConnection: { name: "connection-b" } },
    ],
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 2, 4]),
    routeEndPort: new Int32Array([1, 3, 5]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)
  for (const [routeId, fromPortId, toPortId] of [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 5],
  ] as Array<[RouteId, PortId, PortId]>) {
    const routeNetId = problem.routeNet[routeId]!
    solver.state.currentRouteId = routeId
    solver.state.currentRouteNetId = routeNetId
    solver.state.regionSegments[0]!.push([routeId, fromPortId, toPortId])
    solver.state.portAssignment[fromPortId] = routeNetId
    solver.state.portAssignment[toPortId] = routeNetId
    solver.appendSegmentToRegionCache(0, fromPortId, toPortId)
  }
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.solved = true
  return solver
}

test("unravel solver accepts only beneficial boundary mutations", () => {
  const inputSolver = createCrossedSolvedSolver()
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_HOT_REGIONS: 0,
  })

  solver.solve()

  expect(initialMaxRegionCost).toBeGreaterThan(0)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getMaxRegionCost(solver)).toBe(0)
  expect(solver.stats.acceptedMutationCount).toBe(1)
  expect(solver.stats.optimized).toBe(true)
  expect(solver.getOutput().solvedRoutes).toHaveLength(2)

  const repeatedSolver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_HOT_REGIONS: 0,
  })
  repeatedSolver.solve()
  expect(repeatedSolver.state.regionSegments).toEqual(
    solver.state.regionSegments,
  )
})

test("unravel solver rolls back a plateau search without a peak improvement", () => {
  const inputSolver = duplicateSolvedSolver(createCrossedSolvedSolver(), 10)
  inputSolver.state.regionSegments[0]!.reverse()
  const inputRegionSegments = structuredClone(inputSolver.state.regionSegments)
  const inputOutput = inputSolver.getOutput()
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    FIXED_ROUTE_IDS: [2, 3],
    MAX_HOT_REGIONS: 0,
  })

  solver.solve()

  expect(solver.stats.acceptedMutationCount).toBeGreaterThan(0)
  expect(solver.stats.rolledBackPlateauMutations).toBe(true)
  expect(getMaxRegionCost(solver)).toBe(initialMaxRegionCost)
  expect(solver.state.regionSegments).toEqual(inputRegionSegments)
  expect(solver.getOutput()).toEqual(inputOutput)
  expect(solver.stats.optimized).toBe(false)
})

test("unravel solver permits added wirelength without increasing occupancy", () => {
  const inputSolver = createCrossedSolvedSolver()
  // Crossing cost is angular, so preserve the same solved crossing while
  // making its untwisted boundary assignment physically longer.
  inputSolver.topology.portY[2] = 10
  inputSolver.topology.portY[3] = -10
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_HOT_REGIONS: 0,
  })

  solver.solve()

  expect(initialMaxRegionCost).toBeGreaterThan(0)
  expect(solver.stats.acceptedMutationCount).toBe(1)
  expect(getMaxRegionCost(solver)).toBeLessThan(initialMaxRegionCost)
  expect(solver.stats.finalTotalSegmentLength).toBeGreaterThan(
    solver.stats.initialTotalSegmentLength,
  )
  expect(solver.stats.finalTotalRoutingRisk).toBeLessThan(
    solver.stats.initialTotalRoutingRisk,
  )
  expect(solver.currentSummary.squaredRegionSegmentCount).toBeLessThanOrEqual(
    solver.initialSummary.squaredRegionSegmentCount,
  )
})

test("tracks terminal keepout clearance per obstacle when scoring swaps", () => {
  const inputSolver = createCrossedSolvedSolver()
  inputSolver.topology.portMetadata = Array.from({ length: 6 }, () => ({}))
  inputSolver.topology.portMetadata[1] = {
    _tinyTerminalKeepouts: [
      {
        minX: -1.05,
        minY: 0.95,
        maxX: -0.95,
        maxY: 1.05,
        z: 0,
        traceCenterClearance: 0.05,
      },
      {
        minX: -0.05,
        minY: 0.95,
        maxX: 0.05,
        maxY: 1.05,
        z: 0,
        traceCenterClearance: 0.05,
      },
    ],
  }
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_HOT_REGIONS: 0,
  })

  solver.solve()

  expect(getMaxRegionCost(solver)).toBe(initialMaxRegionCost)
  expect(solver.stats.acceptedMutationCount).toBe(0)
  expect(solver.stats.rejectedBoundaryEndpointKeepoutCount).toBeGreaterThan(0)
})

test("cross-layer swaps preserve each route's layer-change count", () => {
  const inputSolver = createCrossedSolvedSolver(
    new Int32Array([0, 0, 0, 1, 0, 0]),
  )
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_HOT_REGIONS: 0,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedMutationCount).toBe(0)
  expect(solver.stats.rejectedCrossLayerSwapCount).toBeGreaterThan(0)
  expect(solver.state.regionSegments).toEqual(inputSolver.state.regionSegments)
})

test("cross-layer swaps may relocate existing layer changes", () => {
  const inputSolver = createCrossedSolvedSolver(
    new Int32Array([0, 0, 0, 1, 1, 1]),
  )
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_HOT_REGIONS: 0,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedMutationCount).toBe(1)
  expect(solver.stats.rejectedCrossLayerSwapCount).toBe(0)
  expect(solver.state.regionSegments).not.toEqual(
    inputSolver.state.regionSegments,
  )
})

test("unravel solver preserves the input at a zero mutation limit", () => {
  const inputSolver = createCrossedSolvedSolver()
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_MUTATIONS: 0,
  })

  solver.solve()

  expect(getMaxRegionCost(solver)).toBe(getMaxRegionCost(inputSolver))
  expect(solver.stats.acceptedMutationCount).toBe(0)
  expect(solver.stats.optimized).toBe(false)
})

test("unravel solver replaces a route through the hottest region", () => {
  const inputSolver = createSolvedSolverWithAlternatePath()
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_MUTATIONS: 1,
    MAX_HOT_REGIONS: 1,
    REROUTE_CONGESTION_FACTORS: [0],
    MAX_REROUTE_SEGMENT_INCREASE: 10,
  })

  solver.solve()

  expect(getMaxRegionCost(inputSolver)).toBeGreaterThan(0)
  expect(getMaxRegionCost(solver)).toBe(0)
  expect(solver.stats.lastMutationKind).toBe("reroute")
  expect(solver.stats.acceptedPairRerouteMutationCount).toBe(0)
  expect(solver.stats.pairRerouteSearchCount).toBe(0)
  expect(solver.stats.finalMaxRoutingRisk).toBeLessThanOrEqual(
    solver.stats.initialMaxRoutingRisk,
  )
  expect(solver.stats.finalTotalRoutingRisk).toBeLessThanOrEqual(
    solver.stats.initialTotalRoutingRisk,
  )
  expect(solver.stats.finalMaxDownstreamRisk).toBeLessThanOrEqual(
    solver.stats.initialMaxDownstreamRisk,
  )
  expect(solver.stats.finalTotalDownstreamRisk).toBeLessThanOrEqual(
    solver.stats.initialTotalDownstreamRisk,
  )
  expect(solver.state.regionSegments[3]!.map(([routeId]) => routeId)).toEqual([
    0, 2,
  ])

  const output = solver.getOutput()
  expect(output.solvedRoutes).toHaveLength(3)
  const { topology, problem, solution } = loadSerializedHyperGraph(output)
  const replaySolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  ).baselineSolver
  expect(getMaxRegionCost(replaySolver)).toBe(getMaxRegionCost(solver))
})

test("unravel solver optimizes movable routes around fixed solved copper", () => {
  const inputSolver = createSolvedSolverWithAlternatePath()
  const fixedSegments = inputSolver.state.regionSegments.map((segments) =>
    segments.filter(([routeId]) => routeId === 1),
  )
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    FIXED_ROUTE_IDS: [1],
    REROUTE_CONGESTION_FACTORS: [0],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.fixedRouteCount).toBe(1)
  expect(getMaxRegionCost(solver)).toBe(0)
  expect(
    solver.state.regionSegments.map((segments) =>
      segments.filter(([routeId]) => routeId === 1),
    ),
  ).toEqual(fixedSegments)
  expect(solver.stats.acceptedRerouteMutationCount).toBeGreaterThan(0)
})

test("reroute search explores around terminal keepouts instead of accepting an unsafe path", () => {
  const inputSolver = createSolvedSolverWithAlternatePath()
  inputSolver.topology.portX.set([
    -2, -1, 1, -1, 0, 1, 2, 0, 0, 0, 0, -0.5, 0.5,
  ])
  inputSolver.topology.portY.set([0, 0, 0, 1, 1, 1, 0, -1, -0.5, 0.5, 1, 1, 1])
  inputSolver.topology.portMetadata = Array.from({ length: 13 }, () => ({}))
  inputSolver.topology.portMetadata[7] = {
    _tinyTerminalKeepouts: [
      {
        minX: -0.1,
        minY: 0.9,
        maxX: 0.1,
        maxY: 1.1,
        z: 0,
        traceCenterClearance: 0.05,
        viaCenterClearance: 0.1,
      },
    ],
  }
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_MUTATIONS: 1,
    MAX_HOT_REGIONS: 1,
    REROUTE_CONGESTION_FACTORS: [0],
    MAX_REROUTE_SEGMENT_INCREASE: 10,
  })

  solver.solve()

  expect(getMaxRegionCost(solver)).toBe(initialMaxRegionCost)
  expect(solver.stats.acceptedMutationCount).toBe(0)
  expect(solver.stats.prunedRerouteEndpointKeepoutSegmentCount).toBeGreaterThan(
    0,
  )
  expect(solver.stats.rejectedRerouteEndpointKeepoutCount).toBe(0)
  expect(solver.stats.terminalKeepoutGeometryCacheHitCount).toBeGreaterThan(0)
  expect(solver.stats.terminalKeepoutGeometryCacheSize).toBeGreaterThan(0)
  expect(solver.stats.terminalKeepoutGeometryCacheSize).toBeLessThan(
    solver.stats.terminalKeepoutBroadPhaseQueryCount,
  )
  expect(solver.stats.terminalKeepoutExactCheckCount).toBeGreaterThan(0)
  expect(solver.stats.terminalKeepoutExactCheckCount).toBeLessThan(
    solver.stats.terminalKeepoutBroadPhaseCandidateCount,
  )
  expect(
    solver.stats.terminalKeepoutPhysicalNeighborCacheMissCount,
  ).toBeGreaterThan(0)
  expect(
    solver.stats.terminalKeepoutPhysicalNeighborCacheHitCount,
  ).toBeGreaterThan(0)
})

test("unravel solver stops rerouting once the bottleneck is eliminated", () => {
  const inputSolver = createSolvedSolverWithIndependentAlternatePaths()
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_REROUTE_SEGMENT_INCREASE: 10,
  })

  solver.solve()

  expect(getMaxRegionCost(solver)).toBe(0)
  expect(solver.stats.acceptedRerouteMutationCount).toBe(1)
  expect(solver.stats.reusedRerouteCandidateCount).toBe(0)
  expect(solver.stats.optimizationStopReason).toBe("local_optimum")
})

test("unravel solver escapes a one-route local optimum with paired reroutes", () => {
  const inputSolver = createSolvedSolverRequiringPairedReroutes()
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_MUTATIONS: 1,
    REROUTE_CONGESTION_FACTORS: [0],
  })

  solver.solve()

  expect(initialMaxRegionCost).toBeGreaterThan(0)
  expect(getMaxRegionCost(solver)).toBe(0)
  expect(solver.stats.acceptedRerouteMutationCount).toBe(1)
  expect(solver.stats.acceptedPairRerouteMutationCount).toBe(1)
  expect(solver.stats.lastMutationRouteIds).toHaveLength(2)
})

test("routing risk groups split routes by downstream connection name", () => {
  const inputSolver = createSolvedSolverWithSharedDownstreamConnection()
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_MUTATIONS: 0,
  })
  const distinctInputSolver = createSolvedSolverWithSharedDownstreamConnection()
  distinctInputSolver.problem.routeMetadata![1] = {
    simpleRouteConnection: { name: "connection-c" },
  }
  const distinctSolver = new UnravelTinyHyperGraphSolver(distinctInputSolver, {
    MAX_MUTATIONS: 0,
  })

  expect(solver.initialSummary.totalDownstreamRisk).toBeGreaterThan(0)
  expect(distinctSolver.initialSummary.totalDownstreamRisk).toBeGreaterThan(
    solver.initialSummary.totalDownstreamRisk,
  )
  expect(solver.initialSummary.totalRoutingRisk).toBeGreaterThan(
    solver.initialSummary.totalDownstreamRisk,
  )
})

test("unravel solver rejects a cost-improving route detour at a zero ceiling", () => {
  const inputSolver = createSolvedSolverWithAlternatePath()
  const initialMaxRegionCost = getMaxRegionCost(inputSolver)
  const initialSegmentCount = getTotalSegmentCount(inputSolver)
  const solver = new UnravelTinyHyperGraphSolver(inputSolver, {
    MAX_MUTATIONS: 1,
    MAX_HOT_REGIONS: 1,
    REROUTE_CONGESTION_FACTORS: [0],
    MAX_REROUTE_SEGMENT_INCREASE: 0,
  })

  solver.solve()

  expect(getMaxRegionCost(solver)).toBe(initialMaxRegionCost)
  expect(getTotalSegmentCount(solver)).toBe(initialSegmentCount)
  expect(solver.stats.acceptedMutationCount).toBe(0)
  expect(solver.stats.rejectedRerouteDetourCount).toBeGreaterThan(0)
})

test("unravel solver requires a completed input solve", () => {
  const inputSolver = createCrossedSolvedSolver()
  inputSolver.solved = false

  expect(() => new UnravelTinyHyperGraphSolver(inputSolver)).toThrow(
    "requires a successfully solved input solver",
  )
})
