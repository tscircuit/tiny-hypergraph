import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { PortId, RegionId, RouteId } from "lib/types"

class TestOutsideInPartialRipSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  preferredPreservedRouteIds = new Set<RouteId>()

  protected override getRouteIdsPreferredForPreservation() {
    return this.preferredPreservedRouteIds
  }

  prepare(hotRegionIds: RegionId[], regionCosts: Float64Array): boolean {
    return this.preparePartialRip(hotRegionIds, regionCosts)
  }

  getActiveEndpoints(routeId: RouteId): [PortId, PortId] {
    return [this.getRouteStartPortId(routeId), this.getRouteEndPortId(routeId)]
  }
}

const createLinearSolver = (
  outsideInMaxDistance = 24,
  options: TinyHyperGraphSolverOptions = {},
  routeCount = 1,
) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 6,
    regionIncidentPorts: [[0], [0, 1], [1, 2], [2, 3], [3, 4], [4]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ],
    regionWidth: new Float64Array(6).fill(100),
    regionHeight: new Float64Array(6).fill(100),
    regionCenterX: new Float64Array([0, 2.5, 7.5, 12.5, 17.5, 20]),
    regionCenterY: new Float64Array(6),
    portAngleForRegion1: new Int32Array([18000, 18000, 18000, 18000, 18000]),
    portAngleForRegion2: new Int32Array([0, 0, 0, 0, 0]),
    portX: new Float64Array([0, 5, 10, 15, 20]),
    portY: new Float64Array(5),
    portZ: new Int32Array(5),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount,
    portSectionMask: new Int8Array(5).fill(1),
    routeStartPort: new Int32Array(routeCount).fill(0),
    routeEndPort: new Int32Array(routeCount).fill(4),
    routeNet: new Int32Array(routeCount),
    regionNetId: new Int32Array(6).fill(-1),
  }
  const solver = new TestOutsideInPartialRipSolver(topology, problem, {
    PARTIAL_RIP_MAX_DISTANCE: 3,
    PARTIAL_RIP_MAX_ATTEMPTS: 1,
    OUTSIDE_IN_MAX_DISTANCE: outsideInMaxDistance,
    STATIC_REACHABILITY_PRECHECK: false,
    ...options,
  })

  solver.state.portAssignment.fill(0)
  solver.state.unroutedRoutes = []
  solver.state.regionSegments[1] = [[0, 0, 1]]
  solver.state.regionSegments[2] = [[0, 1, 2]]
  solver.state.regionSegments[3] = [[0, 2, 3]]
  solver.state.regionSegments[4] = [[0, 3, 4]]
  return solver
}

test("partial rip preserves both outside route ends", () => {
  const solver = createLinearSolver()
  const regionCosts = new Float64Array(6)
  regionCosts[3] = 1

  expect(solver.prepare([3], regionCosts)).toBe(true)
  expect(solver.getActiveEndpoints(0)).toEqual([2, 3])
  expect(solver.getStartingNextRegionId(0, 2)).toBe(3)
  expect(solver.state.unroutedRoutes).toEqual([0])
  expect(solver.state.regionSegments.flat()).toEqual([
    [0, 0, 1],
    [0, 1, 2],
    [0, 3, 4],
  ])
  expect(solver.stats.partiallyRippedSegmentCount).toBe(1)
  expect(solver.stats.retainedPartialRipSegmentCount).toBe(3)
})

test("partial rip leaves preferred routes unchanged", () => {
  const solver = createLinearSolver(24, {}, 2)
  solver.preferredPreservedRouteIds.add(0)
  for (let regionId = 1; regionId <= 4; regionId++) {
    const [routeZeroSegment] = solver.state.regionSegments[regionId]!
    solver.state.regionSegments[regionId]!.push([
      1,
      routeZeroSegment![1],
      routeZeroSegment![2],
    ])
  }
  const regionCosts = new Float64Array(6)
  regionCosts[3] = 1

  expect(solver.prepare([3], regionCosts)).toBe(true)
  expect(solver.state.unroutedRoutes).toEqual([1])
  expect(
    solver.state.regionSegments
      .flat()
      .filter(([routeId]) => routeId === 0),
  ).toEqual([
    [0, 0, 1],
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
  ])
})

test("a near-target initial solution selects the larger quality window", () => {
  const nearTargetSolver = createLinearSolver()
  nearTargetSolver.PARTIAL_RIP_QUALITY_MAX_DISTANCE = 8
  const nearTargetCosts = new Float64Array(6)
  nearTargetCosts[3] = 1

  expect(nearTargetSolver.prepare([3], nearTargetCosts)).toBe(true)
  expect(nearTargetSolver.stats.partialRipMaxDistance).toBe(8)

  const congestedSolver = createLinearSolver()
  congestedSolver.PARTIAL_RIP_QUALITY_MAX_DISTANCE = 8
  const congestedCosts = new Float64Array(6)
  congestedCosts[3] = 2

  expect(congestedSolver.prepare([3], congestedCosts)).toBe(true)
  expect(congestedSolver.stats.partialRipMaxDistance).toBe(3)
})

test("outside-in routing reconnects a partial span from both retained ends", () => {
  const solver = createLinearSolver()
  const regionCosts = new Float64Array(6)
  regionCosts[3] = 1
  solver.prepare([3], regionCosts)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.outsideInCompletedRouteCount).toBe(1)
  expect(solver.stats.outsideInForwardExpansionCount).toBeGreaterThan(0)
  expect(solver.stats.outsideInReverseExpansionCount).toBeGreaterThan(0)
  expect(solver.state.regionSegments.flat()).toHaveLength(4)
  expect(solver.getOutput().solvedRoutes?.[0]?.path).toHaveLength(5)
})

test("a span beyond the two-frontier distance budget falls back safely", () => {
  const solver = createLinearSolver(2)
  const regionCosts = new Float64Array(6)
  regionCosts[3] = 1
  solver.prepare([3], regionCosts)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.outsideInFallbackRouteCount).toBe(1)
  expect(solver.state.regionSegments.flat()).toHaveLength(4)
})

test("small graphs bypass partial rip and outside-in routing", () => {
  const solver = createLinearSolver(24, {
    PARTIAL_RIP_MIN_ROUTE_COUNT: 2,
  })

  expect(solver.PARTIAL_RIP_ENABLED).toBe(false)
  expect(solver.OUTSIDE_IN_ROUTING).toBe(false)
})

test("oversized graphs bypass partial rip and outside-in routing", () => {
  const solver = createLinearSolver(
    24,
    {
      PARTIAL_RIP_MAX_ROUTE_COUNT: 2,
    },
    3,
  )

  expect(solver.PARTIAL_RIP_ENABLED).toBe(false)
  expect(solver.OUTSIDE_IN_ROUTING).toBe(false)
})

test("the configured warmup performs a whole-graph rerip first", () => {
  const solver = createLinearSolver(24, {
    PARTIAL_RIP_MAX_ATTEMPTS: 1,
    PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS: 1,
  })
  solver.state.regionIntersectionCaches[3]!.existingRegionCost = 1

  solver.onAllRoutesRouted()

  expect(solver.state.ripCount).toBe(1)
  expect(solver.stats.reripMode).toBe("warmup_full")
  expect(solver.stats.partialRipCount ?? 0).toBe(0)
})

test("the partial-rip cap does not compress the threshold ramp", () => {
  const solver = createLinearSolver(24, {
    RIP_THRESHOLD_START: 0.05,
    RIP_THRESHOLD_END: 0.8,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 10,
    PARTIAL_RIP_MAX_ATTEMPTS: 1,
  })
  solver.state.ripCount = 1
  solver.state.regionIntersectionCaches[3]!.existingRegionCost = 1

  solver.onAllRoutesRouted()

  expect(solver.solved).toBe(true)
  expect(solver.stats.currentRipThreshold).toBeCloseTo(0.125)
})

test("complexity-aware selection activates only at its route-count gate", () => {
  const belowGateSolver = createLinearSolver(24, {
    PARTIAL_RIP_MAX_ATTEMPTS: 0,
    PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 100,
  })
  belowGateSolver.onAllRoutesRouted()

  const atGateSolver = createLinearSolver(
    24,
    {
      PARTIAL_RIP_MAX_ATTEMPTS: 0,
      PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 100,
    },
    100,
  )
  atGateSolver.onAllRoutesRouted()

  expect(belowGateSolver.stats.partialRipComplexityAwareSelection).toBe(false)
  expect(atGateSolver.stats.partialRipComplexityAwareSelection).toBe(true)
})

test("complexity selection cannot exceed the first solution cost envelope", () => {
  const solver = createLinearSolver(
    24,
    {
      PARTIAL_RIP_MAX_ATTEMPTS: 1,
      PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 100,
      PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: 0.2,
      PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
    },
    100,
  )
  solver.state.regionIntersectionCaches[3]!.existingRegionCost = 1

  solver.onAllRoutesRouted()

  solver.state.portAssignment.fill(0)
  solver.state.unroutedRoutes = []
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.state.regionSegments = Array.from({ length: 6 }, () => [])
  solver.state.regionSegments[1] = [[0, 0, 1]]
  solver.state.regionSegments[2] = [[0, 1, 2]]
  solver.state.regionSegments[3] = [[0, 2, 3]]
  solver.state.regionSegments[4] = [[0, 3, 4]]
  for (const cache of solver.state.regionIntersectionCaches) {
    cache.existingRegionCost = 0
  }
  solver.state.regionIntersectionCaches[3]!.existingRegionCost = 1.21

  solver.onAllRoutesRouted()

  expect(solver.solved).toBe(true)
  expect(solver.stats.bestMaxRegionCost).toBe(1)
  expect(solver.state.regionIntersectionCaches[3]!.existingRegionCost).toBe(1)
})
