import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "lib2/domain"
import {
  buildLayeredSearchMap,
  findLayeredRouteCorridor,
} from "lib2/layered-search-map"
import { MinHeap } from "lib2/min-heap"
import { TinyHyperGraphSolver2 } from "lib2/solver"
import type { Candidate } from "lib2/domain"

const compareCandidate = (left: Candidate, right: Candidate) =>
  left.f - right.f

const createLineTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 3,
  regionIncidentPorts: [
    [0, 1],
    [1, 2],
    [2, 3],
  ],
  incidentPortRegion: [[0], [0, 1], [1, 2], [2]],
  regionWidth: new Float64Array([1, 1, 1]),
  regionHeight: new Float64Array([1, 1, 1]),
  regionCenterX: new Float64Array([0, 10, 20]),
  regionCenterY: new Float64Array([0, 0, 0]),
  regionAvailableZMask: new Int32Array([1, 1, 1]),
  portAngleForRegion1: new Int32Array([0, 0, 0, 0]),
  portAngleForRegion2: new Int32Array([0, 0, 0, 0]),
  portX: new Float64Array([0, 5, 15, 20]),
  portY: new Float64Array([0, 0, 0, 0]),
  portZ: new Int32Array([0, 0, 0, 0]),
})

const createProblem = (regionNetId: Int32Array): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array([1, 1, 1, 1]),
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([3]),
  routeNet: new Int32Array([1]),
  regionNetId,
})

const createWorkingState = (): TinyHyperGraphWorkingState => ({
  portAssignment: new Int32Array([-1, -1, -1, -1]),
  regionSegments: [[], [], []],
  regionIntersectionCaches: [],
  currentRouteNetId: 1,
  currentRouteId: 0,
  unroutedRoutes: [],
  candidateQueue: new MinHeap([], compareCandidate),
  candidateBestCostByHopId: new Float64Array(12),
  candidateBestCostGenerationByHopId: new Uint32Array(12),
  candidateBestCostGeneration: 1,
  goalPortId: 3,
  ripCount: 0,
  regionCongestionCost: new Float64Array([0, 0, 0]),
})

test("layered search map groups regions and builds coarse adjacency", () => {
  const topology = createLineTopology()
  const layeredMap = buildLayeredSearchMap(topology, { bucketSize: 5 })

  expect(Array.from(layeredMap.fineToCoarseRegionId)).toEqual([0, 1, 2])
  expect(layeredMap.coarseAdjacency).toEqual([[1], [0, 2], [1]])
  expect(Array.from(layeredMap.coarseAvailableZMask)).toEqual([1, 1, 1])
})

test("layered route corridor finds a coarse path and fine mask", () => {
  const topology = createLineTopology()
  const problem = createProblem(new Int32Array([-1, -1, -1]))
  const layeredMap = buildLayeredSearchMap(topology, { bucketSize: 5 })
  const result = findLayeredRouteCorridor({
    layeredMap,
    topology,
    problem,
    regionCongestionCost: createWorkingState().regionCongestionCost,
    currentRouteNetId: 1,
    startRegionId: 0,
    goalPortId: 3,
    distanceToCost: 1,
    includeAdjacentCoarseRegions: false,
  })

  expect(result._tag).toBe("found")
  if (result._tag === "found") {
    expect(result.coarsePath).toEqual([0, 1, 2])
    expect(Array.from(result.allowedFineRegionMask)).toEqual([1, 1, 1])
  }
})

test("layered route corridor rejects a foreign-net coarse bottleneck", () => {
  const topology = createLineTopology()
  const problem = createProblem(new Int32Array([-1, 2, -1]))
  const layeredMap = buildLayeredSearchMap(topology, { bucketSize: 5 })
  const result = findLayeredRouteCorridor({
    layeredMap,
    topology,
    problem,
    regionCongestionCost: createWorkingState().regionCongestionCost,
    currentRouteNetId: 1,
    startRegionId: 0,
    goalPortId: 3,
    distanceToCost: 1,
    includeAdjacentCoarseRegions: false,
  })

  expect(result).toEqual({
    _tag: "notFound",
    error: "No coarse path from region 0 to goal port 3",
  })
})

test("solver can route through layered search when enabled", () => {
  const topology = createLineTopology()
  const problem = createProblem(new Int32Array([-1, -1, -1]))
  const solver = new TinyHyperGraphSolver2(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    USE_LAYERED_ROUTE_SEARCH: true,
    LAYERED_SEARCH_BUCKET_SIZE: 5,
    LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS: false,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.regionSegments[0]).toHaveLength(1)
  expect(solver.state.regionSegments[1]).toHaveLength(1)
  expect(solver.state.regionSegments[2]).toHaveLength(1)
})
