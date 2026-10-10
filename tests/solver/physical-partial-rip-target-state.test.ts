import { expect, test } from "bun:test"
import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "lib/outside-in-partial-rip-tiny-hypergraph-solver"

test("physical rerip targets use the selected output", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 8,
    regionCount: 5,
    regionIncidentPorts: [
      [2, 3, 6, 7],
      [0, 4, 6],
      [1, 5, 7],
      [4, 5],
      [0, 1, 2, 3],
    ],
    incidentPortRegion: [
      [1, 4],
      [2, 4],
      [0, 4],
      [0, 4],
      [1, 3],
      [3, 2],
      [1, 0],
      [0, 2],
    ],
    regionWidth: Float64Array.of(3, 6, 6, 6, 1),
    regionHeight: Float64Array.of(3, 6, 6, 6, 1),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    regionAvailableZMask: new Int32Array(5).fill(3),
    portAngleForRegion1: Int32Array.of(0, 0, 9000, 27000, 0, 0, 18000, 0),
    portX: Float64Array.of(-2, 2, 0, 0, -1, 1, -1, 1),
    portY: Float64Array.of(0, 0, -1, 1, -2, -2, 0, 0),
    portZ: Int32Array.of(0, 0, 0, 0, 1, 1, 0, 0),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: Int32Array.of(0, 2),
    routeEndPort: Int32Array.of(1, 3),
    routeNet: Int32Array.of(0, 1),
    portSectionMask: new Int8Array(8).fill(1),
    regionNetId: new Int32Array(5).fill(-1),
    portPenalty: Float64Array.of(0, 0, 0, 0, 10, 10, 0, 0),
  }
  const complete = (
    solver: OutsideInPartialRipTinyHyperGraphSolver,
    detour: boolean,
  ): void => {
    solver.state.regionSegments = Array.from({ length: 5 }, () => [])
    solver.state.regionIntersectionCaches = Array.from(
      { length: 5 },
      createEmptyRegionIntersectionCache,
    )
    solver.state.portAssignment.fill(-1)
    const segments: Array<[number, number, number, number]> = detour
      ? [
          [0, 1, 0, 4],
          [0, 3, 4, 5],
          [0, 2, 5, 1],
          [1, 0, 2, 3],
        ]
      : [
          [0, 1, 0, 6],
          [0, 0, 6, 7],
          [0, 2, 7, 1],
          [1, 0, 2, 3],
        ]
    for (const [route, region, from, to] of segments) {
      solver.state.currentRouteNetId = route
      solver.state.regionSegments[region]!.push([route, from, to])
      solver.state.portAssignment[from] = route
      solver.state.portAssignment[to] = route
      solver.appendSegmentToRegionCache(region, from, to)
    }
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = []
    solver.onAllRoutesRouted()
  }
  for (const viaCost of [0.6, 0]) {
    const solver = new OutsideInPartialRipTinyHyperGraphSolver(
      topology,
      problem,
      {
        VIA_COST: viaCost,
        CROSS_LAYER_INTERSECTION_COST_FACTOR: 0,
        RIP_THRESHOLD_START: 0,
        RIP_THRESHOLD_END: 0,
        PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
        PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 0,
        PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS: 0,
        PARTIAL_RIP_TARGET_MAX_COST_IMPROVEMENT_RATIO: 0.02,
        PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: 0.05,
        PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
        PARTIAL_RIP_MAX_ATTEMPTS: 2,
      },
    )
    complete(solver, false)
    complete(solver, true)
    if (viaCost > 0) {
      expect(solver.solved).toBe(false)
      expect(solver.stats.partialRipTargetReached).toBe(false)
      expect(solver.state.ripCount).toBe(2)
      complete(solver, true)
    } else {
      expect(solver.stats.partialRipTargetReached).toBe(true)
    }
    expect(solver.solved).toBe(true)
    const path = solver
      .getOutput()
      .solvedRoutes![0]!.path.map((candidate) => candidate.portId)
    expect(path).toEqual(
      viaCost > 0
        ? ["port-0", "port-6", "port-7", "port-1"]
        : ["port-0", "port-4", "port-5", "port-1"],
    )
  }
})
