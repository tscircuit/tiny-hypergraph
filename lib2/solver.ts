import { BaseSolver } from "@tscircuit/solver-utils"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./graph-output"
import {
  computeRegionCost,
  DEFAULT_MIN_VIA_PAD_DIAMETER,
  isKnownSingleLayerMask,
} from "./compute-region-cost"
import { MinHeap } from "./min-heap"
import { shuffle } from "./shuffle"
import type { StaticallyUnroutableRouteSummary } from "../lib/static-reachability"
import {
  createStaticallyUnroutableRouteSummary,
  getStaticallyUnroutableRoutes,
  getStaticReachabilityError,
} from "../lib/static-reachability"
import type {
  HopId,
  NetId,
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "./types"
import { range } from "./utils"
import { visualizeTinyGraph } from "../lib/visualizeTinyGraph"
import type {
  Candidate,
  RegionCostSummary,
  TinyHyperGraphProblem,
  TinyHyperGraphProblemSetup,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "./domain"
import {
  loadGraph,
  type LoadGraphError,
  parseGraph,
  type ParseGraphError,
} from "./graph-input"
import {
  buildLayeredSearchMap,
  findLayeredRouteCorridor,
  type LayeredSearchMap,
} from "./layered-search-map"
import { err, ok, type Result } from "./prelude"
import { MutableRegionCache } from "./region-cache"
import {
  ROUTE_SEARCH_ADVANCED,
  ROUTE_SEARCH_ALL_ROUTES_ROUTED,
  ROUTE_SEARCH_OUT_OF_CANDIDATES,
  runRouteSearchStep,
  type RouteSearchFailure,
} from "./route-search"
import {
  createSegmentGeometryScratch,
  readSegmentGeometry,
  type SegmentGeometryScratch,
} from "./segment-geometry"

export type { StaticallyUnroutableRouteSummary } from "../lib/static-reachability"
export type {
  Candidate,
  RegionCostSummary,
  TinyHyperGraphProblem,
  TinyHyperGraphProblemSetup,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "./domain"

const GREEDY_FINAL_ROUTE_MAX_ITERATIONS = 50e3

/** Internal lib2 invariant failure that should not be hidden by display fallbacks. */
export class SolverInvariantError extends Error {
  readonly _tag = "SolverInvariantError"

  constructor(
    readonly routeId: RouteId | undefined,
    readonly reason: string,
  ) {
    super(
      routeId === undefined
        ? `Solver invariant failed: ${reason}`
        : `Solver invariant failed for route ${routeId}: ${reason}`,
    )
  }
}

export const getExistingRegionCost = (
  regionIntersectionCaches: ArrayLike<RegionIntersectionCache>,
  regionId: RegionId,
): number => {
  const cache = regionIntersectionCaches[regionId]
  if (cache === undefined) {
    throw new SolverInvariantError(
      undefined,
      `missing region intersection cache for region ${regionId}`,
    )
  }

  return cache.existingRegionCost
}

export const createEmptyRegionIntersectionCache =
  (): RegionIntersectionCache => ({
    netIds: new Int32Array(0),
    lesserAngles: new Int32Array(0),
    greaterAngles: new Int32Array(0),
    layerMasks: new Int32Array(0),
    existingCrossingLayerIntersections: 0,
    existingSameLayerIntersections: 0,
    existingEntryExitLayerChanges: 0,
    existingRegionCost: 0,
    existingSegmentCount: 0,
  })

const cloneRegionSegments = (
  regionSegments: Array<[RouteId, PortId, PortId][]>,
): Array<[RouteId, PortId, PortId][]> =>
  regionSegments.map((segments) =>
    segments.map(
      ([routeId, fromPortId, toPortId]) =>
        [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
    ),
  )

const cloneRegionIntersectionCache = (
  regionIntersectionCache: RegionIntersectionCache,
): RegionIntersectionCache => ({
  netIds: new Int32Array(regionIntersectionCache.netIds),
  lesserAngles: new Int32Array(regionIntersectionCache.lesserAngles),
  greaterAngles: new Int32Array(regionIntersectionCache.greaterAngles),
  layerMasks: new Int32Array(regionIntersectionCache.layerMasks),
  existingCrossingLayerIntersections:
    regionIntersectionCache.existingCrossingLayerIntersections,
  existingSameLayerIntersections:
    regionIntersectionCache.existingSameLayerIntersections,
  existingEntryExitLayerChanges:
    regionIntersectionCache.existingEntryExitLayerChanges,
  existingRegionCost: regionIntersectionCache.existingRegionCost,
  existingSegmentCount: regionIntersectionCache.existingSegmentCount,
})

const cloneSolvedStateSnapshot = (
  snapshot: SolvedStateSnapshot,
): SolvedStateSnapshot => ({
  portAssignment: new Int32Array(snapshot.portAssignment),
  regionSegments: cloneRegionSegments(snapshot.regionSegments),
  regionIntersectionCaches: snapshot.regionIntersectionCaches.map(
    cloneRegionIntersectionCache,
  ),
  regionCongestionCost: new Float64Array(snapshot.regionCongestionCost),
  ripCount: snapshot.ripCount,
})

interface SolvedStateSnapshot {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
  regionCongestionCost: Float64Array
  ripCount: number
}

export interface NeverSuccessfullyRoutedRouteSummary {
  routeId: RouteId
  connectionId: string
  attempts: number
  startPortId: PortId
  endPortId: PortId
  startRegionId?: string
  endRegionId?: string
  pointIds: string[]
}

export interface TinyHyperGraphSolver2Options {
  minViaPadDiameter?: number
  DISTANCE_TO_COST?: number
  RIP_THRESHOLD_START?: number
  RIP_THRESHOLD_END?: number
  RIP_THRESHOLD_RAMP_ATTEMPTS?: number
  RIP_CONGESTION_REGION_COST_FACTOR?: number
  USE_LAZY_ROUTE_HEURISTIC?: boolean
  USE_SPARSE_CANDIDATE_STORAGE?: boolean
  MAX_ITERATIONS?: number
  VERBOSE?: boolean
  STATIC_REACHABILITY_PRECHECK?: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS?: number
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT?: boolean
  GREEDY_FINAL_ROUTE_ITERS?: number
  USE_LAYERED_ROUTE_SEARCH?: boolean
  LAYERED_SEARCH_BUCKET_SIZE?: number
  LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS?: boolean
}

export interface TinyHyperGraphSolver2OptionTarget {
  minViaPadDiameter: number
  DISTANCE_TO_COST: number
  RIP_THRESHOLD_START: number
  RIP_THRESHOLD_END: number
  RIP_THRESHOLD_RAMP_ATTEMPTS: number
  RIP_CONGESTION_REGION_COST_FACTOR: number
  USE_LAZY_ROUTE_HEURISTIC?: boolean
  USE_SPARSE_CANDIDATE_STORAGE?: boolean
  MAX_ITERATIONS: number
  VERBOSE: boolean
  STATIC_REACHABILITY_PRECHECK: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS: number
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT: boolean
  GREEDY_FINAL_ROUTE_ITERS: number
  USE_LAYERED_ROUTE_SEARCH?: boolean
  LAYERED_SEARCH_BUCKET_SIZE?: number
  LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS?: boolean
}

export const applyTinyHyperGraphSolver2Options = (
  solver: TinyHyperGraphSolver2OptionTarget,
  options?: TinyHyperGraphSolver2Options,
) => {
  if (!options) {
    return
  }

  if (options.minViaPadDiameter !== undefined) {
    solver.minViaPadDiameter = options.minViaPadDiameter
  }
  if (options.DISTANCE_TO_COST !== undefined) {
    solver.DISTANCE_TO_COST = options.DISTANCE_TO_COST
  }
  if (options.RIP_THRESHOLD_START !== undefined) {
    solver.RIP_THRESHOLD_START = options.RIP_THRESHOLD_START
  }
  if (options.RIP_THRESHOLD_END !== undefined) {
    solver.RIP_THRESHOLD_END = options.RIP_THRESHOLD_END
  }
  if (options.RIP_THRESHOLD_RAMP_ATTEMPTS !== undefined) {
    solver.RIP_THRESHOLD_RAMP_ATTEMPTS = options.RIP_THRESHOLD_RAMP_ATTEMPTS
  }
  if (options.RIP_CONGESTION_REGION_COST_FACTOR !== undefined) {
    solver.RIP_CONGESTION_REGION_COST_FACTOR =
      options.RIP_CONGESTION_REGION_COST_FACTOR
  }
  if (options.USE_LAZY_ROUTE_HEURISTIC !== undefined) {
    solver.USE_LAZY_ROUTE_HEURISTIC = options.USE_LAZY_ROUTE_HEURISTIC
  }
  if (options.USE_SPARSE_CANDIDATE_STORAGE !== undefined) {
    solver.USE_SPARSE_CANDIDATE_STORAGE = options.USE_SPARSE_CANDIDATE_STORAGE
  }
  if (options.MAX_ITERATIONS !== undefined) {
    solver.MAX_ITERATIONS = options.MAX_ITERATIONS
  }
  if (options.VERBOSE !== undefined) {
    solver.VERBOSE = options.VERBOSE
  }
  if (options.STATIC_REACHABILITY_PRECHECK !== undefined) {
    solver.STATIC_REACHABILITY_PRECHECK = options.STATIC_REACHABILITY_PRECHECK
  }
  if (options.STATIC_REACHABILITY_PRECHECK_MAX_HOPS !== undefined) {
    solver.STATIC_REACHABILITY_PRECHECK_MAX_HOPS =
      options.STATIC_REACHABILITY_PRECHECK_MAX_HOPS
  }
  if (options.ACCEPT_BEST_SOLUTION_ON_TIMEOUT !== undefined) {
    solver.ACCEPT_BEST_SOLUTION_ON_TIMEOUT =
      options.ACCEPT_BEST_SOLUTION_ON_TIMEOUT
  }
  if (options.GREEDY_FINAL_ROUTE_ITERS !== undefined) {
    solver.GREEDY_FINAL_ROUTE_ITERS = options.GREEDY_FINAL_ROUTE_ITERS
  }
  if (options.USE_LAYERED_ROUTE_SEARCH !== undefined) {
    solver.USE_LAYERED_ROUTE_SEARCH = options.USE_LAYERED_ROUTE_SEARCH
  }
  if (options.LAYERED_SEARCH_BUCKET_SIZE !== undefined) {
    solver.LAYERED_SEARCH_BUCKET_SIZE = options.LAYERED_SEARCH_BUCKET_SIZE
  }
  if (options.LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS !== undefined) {
    solver.LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS =
      options.LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS
  }
}

export const getTinyHyperGraphSolver2Options = (
  solver: TinyHyperGraphSolver2OptionTarget,
): TinyHyperGraphSolver2Options => ({
  minViaPadDiameter: solver.minViaPadDiameter,
  DISTANCE_TO_COST: solver.DISTANCE_TO_COST,
  RIP_THRESHOLD_START: solver.RIP_THRESHOLD_START,
  RIP_THRESHOLD_END: solver.RIP_THRESHOLD_END,
  RIP_THRESHOLD_RAMP_ATTEMPTS: solver.RIP_THRESHOLD_RAMP_ATTEMPTS,
  RIP_CONGESTION_REGION_COST_FACTOR: solver.RIP_CONGESTION_REGION_COST_FACTOR,
  USE_LAZY_ROUTE_HEURISTIC: solver.USE_LAZY_ROUTE_HEURISTIC,
  USE_SPARSE_CANDIDATE_STORAGE: solver.USE_SPARSE_CANDIDATE_STORAGE,
  MAX_ITERATIONS: solver.MAX_ITERATIONS,
  VERBOSE: solver.VERBOSE,
  STATIC_REACHABILITY_PRECHECK: solver.STATIC_REACHABILITY_PRECHECK,
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS:
    solver.STATIC_REACHABILITY_PRECHECK_MAX_HOPS,
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT: solver.ACCEPT_BEST_SOLUTION_ON_TIMEOUT,
  GREEDY_FINAL_ROUTE_ITERS: solver.GREEDY_FINAL_ROUTE_ITERS,
  USE_LAYERED_ROUTE_SEARCH: solver.USE_LAYERED_ROUTE_SEARCH,
  LAYERED_SEARCH_BUCKET_SIZE: solver.LAYERED_SEARCH_BUCKET_SIZE,
  LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS:
    solver.LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS,
})

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f

export class TinyHyperGraphSolver2 extends BaseSolver {
  state: TinyHyperGraphWorkingState
  private _problemSetup?: TinyHyperGraphProblemSetup
  protected routeAttemptCountByRouteId: Uint32Array
  protected routeSuccessCountByRouteId: Uint32Array
  protected bestSolvedStateSnapshot?: SolvedStateSnapshot
  protected bestSolvedStateSummary?: RegionCostSummary
  private hasLoggedNeverSuccessfullyRoutedRoutes = false
  private staticallyUnroutableRoutes: StaticallyUnroutableRouteSummary[] = []
  private readonly segmentGeometryScratch: SegmentGeometryScratch =
    createSegmentGeometryScratch()
  private regionCaches: MutableRegionCache[] = []
  private layeredSearchMap?: LayeredSearchMap
  private layeredSearchAllowedFineRegionMask?: Uint8Array

  DISTANCE_TO_COST = 0.05 // 50mm = 1 cost unit (1 cost unit ~ 100% chance of failure)
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1
  USE_LAZY_ROUTE_HEURISTIC = false
  USE_SPARSE_CANDIDATE_STORAGE = false

  override MAX_ITERATIONS = 1e6
  VERBOSE = false
  STATIC_REACHABILITY_PRECHECK = true
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS = 16
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT = true
  GREEDY_FINAL_ROUTE_ITERS = 4
  USE_LAYERED_ROUTE_SEARCH = false
  LAYERED_SEARCH_BUCKET_SIZE?: number
  LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS = true

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolver2Options,
  ) {
    super()
    applyTinyHyperGraphSolver2Options(this, options)
    this.state = {
      portAssignment: new Int32Array(topology.portCount).fill(-1),
      regionSegments: Array.from({ length: topology.regionCount }, () => []),
      regionIntersectionCaches: Array.from(
        { length: topology.regionCount },
        () => createEmptyRegionIntersectionCache(),
      ),
      currentRouteId: undefined,
      currentRouteNetId: undefined,
      unroutedRoutes: range(problem.routeCount),
      candidateQueue: new MinHeap([], compareCandidatesByF),
      candidateBestCostByHopId: this.USE_SPARSE_CANDIDATE_STORAGE
        ? new Map()
        : new Float64Array(topology.portCount * topology.regionCount),
      candidateBestCostGenerationByHopId: this.USE_SPARSE_CANDIDATE_STORAGE
        ? new Map()
        : new Uint32Array(topology.portCount * topology.regionCount),
      candidateBestCostGeneration: 1,
      goalPortId: -1,
      ripCount: 0,
      regionCongestionCost: new Float64Array(topology.regionCount).fill(0),
    }
    this.routeAttemptCountByRouteId = new Uint32Array(problem.routeCount)
    this.routeSuccessCountByRouteId = new Uint32Array(problem.routeCount)
    this.regionCaches = this.createRegionCachesFromState()
  }

  get problemSetup(): TinyHyperGraphProblemSetup {
    if (!this._problemSetup) {
      this._problemSetup = this.computeProblemSetup()
    }

    return this._problemSetup
  }

  computeProblemSetup(): TinyHyperGraphProblemSetup {
    const { topology, problem } = this
    const portHCostToEndOfRoute = this.USE_LAZY_ROUTE_HEURISTIC
      ? undefined
      : new Float64Array(topology.portCount * problem.routeCount)
    const portX = topology.portX as unknown as ArrayLike<number>
    const portY = topology.portY as unknown as ArrayLike<number>
    const portEndpointNetIds = Array.from(
      { length: topology.portCount },
      () => new Set<NetId>(),
    )

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      portEndpointNetIds[problem.routeStartPort[routeId]]!.add(
        problem.routeNet[routeId],
      )
      portEndpointNetIds[problem.routeEndPort[routeId]]!.add(
        problem.routeNet[routeId],
      )

      if (portHCostToEndOfRoute) {
        const endPortId = problem.routeEndPort[routeId]
        const endX = portX[endPortId]
        const endY = portY[endPortId]

        for (let portId = 0; portId < topology.portCount; portId++) {
          const dx = portX[portId] - endX
          const dy = portY[portId] - endY
          portHCostToEndOfRoute[portId * problem.routeCount + routeId] =
            Math.hypot(dx, dy) * this.DISTANCE_TO_COST
        }
      }
    }

    return {
      portHCostToEndOfRoute: portHCostToEndOfRoute as Float64Array,
      portEndpointNetIds,
    }
  }

  override _setup() {
    void this.problemSetup

    if (this.STATIC_REACHABILITY_PRECHECK) {
      const staticallyUnroutableRoutes = getStaticallyUnroutableRoutes({
        topology: this.topology,
        problem: this.problem,
        problemSetup: this.problemSetup,
        portAssignment: this.state.portAssignment,
        routeIds: this.state.unroutedRoutes,
        maxPrecheckHops: Math.max(
          0,
          this.STATIC_REACHABILITY_PRECHECK_MAX_HOPS,
        ),
        getStartingNextRegionId: (routeId, startingPortId) =>
          this.getStartingNextRegionId(routeId, startingPortId),
        getRouteSummary: (routeId) => this.getRouteSummary(routeId),
      })
      this.staticallyUnroutableRoutes = staticallyUnroutableRoutes
      if (staticallyUnroutableRoutes.length > 0) {
        this.failed = true
        this.error = getStaticReachabilityError(staticallyUnroutableRoutes)
        this.stats = {
          ...this.stats,
          staticallyUnroutableRouteCount: staticallyUnroutableRoutes.length,
        }
      }
    }

    if (this.USE_LAYERED_ROUTE_SEARCH) {
      this.layeredSearchMap = buildLayeredSearchMap(this.topology, {
        bucketSize: this.LAYERED_SEARCH_BUCKET_SIZE,
      })
    }
  }

  override _step() {
    const result = runRouteSearchStep({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      getHopId: (portId, nextRegionId) => this.getHopId(portId, nextRegionId),
      getCandidateBestCost: (hopId) => this.getCandidateBestCost(hopId),
      setCandidateBestCost: (hopId, cost) =>
        this.setCandidateBestCost(hopId, cost),
      resetCandidateBestCosts: () => this.resetCandidateBestCosts(),
      getStartingNextRegionId: (routeId, startingPortId) =>
        this.getStartingNextRegionId(routeId, startingPortId),
      isPortReservedForDifferentNet: (portId) =>
        this.isPortReservedForDifferentNet(portId),
      isRegionReservedForDifferentNet: (regionId) =>
        this.isRegionReservedForDifferentNet(regionId),
      computeG: (currentCandidate, neighborPortId) =>
        this.computeG(currentCandidate, neighborPortId),
      computeH: (portId) => this.computeH(portId),
      onRouteAttempt: (routeId) => {
        this.routeAttemptCountByRouteId[routeId] += 1
        this.layeredSearchAllowedFineRegionMask = undefined
      },
      prepareRouteSearch: (input) => this.prepareLayeredRouteSearch(input),
      isRegionAllowedForRouteSearch: (regionId) =>
        this.isRegionAllowedForRouteSearch(regionId),
    })

    if (result === ROUTE_SEARCH_ALL_ROUTES_ROUTED) {
      this.onAllRoutesRouted()
      return
    }
    if (result === ROUTE_SEARCH_OUT_OF_CANDIDATES) {
      this.onOutOfCandidates()
      return
    }
    if (result === ROUTE_SEARCH_ADVANCED) {
      return
    }
    if ("_tag" in result) {
      this.onRouteSearchFailure(result)
      return
    }

    this.onPathFound(result)
  }

  protected onRouteSearchFailure(failure: RouteSearchFailure): void {
    if (
      failure.reason === "noLegalStartingRegion" ||
      failure.reason === "coarsePathNotFound"
    ) {
      this.failed = true
      this.error = failure.error
      return
    }

    throw new SolverInvariantError(this.state.currentRouteId, failure.error)
  }

  protected prepareLayeredRouteSearch(input: {
    readonly routeId: RouteId
    readonly startPortId: PortId
    readonly startRegionId: RegionId
    readonly goalPortId: PortId
  }): RouteSearchFailure | undefined {
    if (!this.USE_LAYERED_ROUTE_SEARCH) {
      return undefined
    }

    const currentRouteNetId = this.state.currentRouteNetId
    if (currentRouteNetId === undefined) {
      return {
        _tag: "failed",
        reason: "missingCurrentRouteNet",
        error: "Current route net is missing during layered route search",
      }
    }

    const layeredSearchMap =
      this.layeredSearchMap ??
      buildLayeredSearchMap(this.topology, {
        bucketSize: this.LAYERED_SEARCH_BUCKET_SIZE,
      })
    this.layeredSearchMap = layeredSearchMap

    const corridor = findLayeredRouteCorridor({
      layeredMap: layeredSearchMap,
      topology: this.topology,
      problem: this.problem,
      regionCongestionCost: this.state.regionCongestionCost,
      currentRouteNetId,
      startRegionId: input.startRegionId,
      goalPortId: input.goalPortId,
      distanceToCost: this.DISTANCE_TO_COST,
      includeAdjacentCoarseRegions:
        this.LAYERED_SEARCH_INCLUDE_ADJACENT_COARSE_REGIONS,
    })

    if (corridor._tag === "notFound") {
      return {
        _tag: "failed",
        reason: "coarsePathNotFound",
        error: corridor.error,
      }
    }

    this.layeredSearchAllowedFineRegionMask = corridor.allowedFineRegionMask
    return undefined
  }

  protected isRegionAllowedForRouteSearch(regionId: RegionId): boolean {
    const allowedFineRegionMask = this.layeredSearchAllowedFineRegionMask
    return !allowedFineRegionMask || allowedFineRegionMask[regionId] === 1
  }

  resetCandidateBestCosts() {
    const { state } = this

    if (state.candidateBestCostGeneration === 0xffffffff) {
      if (state.candidateBestCostByHopId instanceof Map) {
        state.candidateBestCostByHopId.clear()
      }
      if (state.candidateBestCostGenerationByHopId instanceof Map) {
        state.candidateBestCostGenerationByHopId.clear()
      } else {
        state.candidateBestCostGenerationByHopId.fill(0)
      }
      state.candidateBestCostGeneration = 1
      return
    }

    state.candidateBestCostGeneration += 1
  }

  getCandidateBestCost(hopId: HopId) {
    const { state } = this
    const bestCostGeneration = state.candidateBestCostGenerationByHopId

    return (bestCostGeneration instanceof Map
      ? bestCostGeneration.get(hopId)
      : bestCostGeneration[hopId]) === state.candidateBestCostGeneration
      ? state.candidateBestCostByHopId instanceof Map
        ? state.candidateBestCostByHopId.get(hopId)!
        : state.candidateBestCostByHopId[hopId]!
      : Number.POSITIVE_INFINITY
  }

  setCandidateBestCost(hopId: HopId, bestCost: number) {
    const { state } = this

    if (state.candidateBestCostGenerationByHopId instanceof Map) {
      state.candidateBestCostGenerationByHopId.set(
        hopId,
        state.candidateBestCostGeneration,
      )
    } else {
      state.candidateBestCostGenerationByHopId[hopId] =
        state.candidateBestCostGeneration
    }

    if (state.candidateBestCostByHopId instanceof Map) {
      state.candidateBestCostByHopId.set(hopId, bestCost)
    } else {
      state.candidateBestCostByHopId[hopId] = bestCost
    }
  }

  getHopId(portId: PortId, nextRegionId: RegionId): HopId {
    return portId * this.topology.regionCount + nextRegionId
  }

  getStartingNextRegionId(
    routeId: RouteId,
    startingPortId: PortId,
  ): RegionId | undefined {
    const startingIncidentRegions =
      this.topology.incidentPortRegion[startingPortId] ?? []
    const currentRouteNetId = this.problem.routeNet[routeId]

    return (
      startingIncidentRegions.find(
        (regionId) => this.problem.regionNetId[regionId] === -1,
      ) ??
      startingIncidentRegions.find(
        (regionId) => this.problem.regionNetId[regionId] === currentRouteNetId,
      )
    )
  }

  isPortReservedForDifferentNet(portId: PortId): boolean {
    const reservedNetIds = this.problemSetup.portEndpointNetIds[portId]
    if (!reservedNetIds) {
      return false
    }

    for (const netId of reservedNetIds) {
      if (netId !== this.state.currentRouteNetId) {
        return true
      }
    }

    return false
  }

  isRegionReservedForDifferentNet(regionId: RegionId): boolean {
    const reservedNetId = this.problem.regionNetId[regionId]
    return (
      reservedNetId !== -1 && reservedNetId !== this.state.currentRouteNetId
    )
  }

  isKnownSingleLayerRegion(regionId: RegionId): boolean {
    const regionAvailableZMask =
      this.topology.regionAvailableZMask?.[regionId] ?? 0
    return isKnownSingleLayerMask(regionAvailableZMask)
  }

  protected computeRegionCostForRegion(
    regionId: RegionId,
    numSameLayerIntersections: number,
    numCrossLayerIntersections: number,
    numEntryExitChanges: number,
    traceCount: number,
  ): number {
    return computeRegionCost(
      this.topology.regionWidth[regionId],
      this.topology.regionHeight[regionId],
      numSameLayerIntersections,
      numCrossLayerIntersections,
      numEntryExitChanges,
      traceCount,
      this.topology.regionAvailableZMask?.[regionId] ?? 0,
      this.minViaPadDiameter,
    )
  }

  populateSegmentGeometryScratch(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ): SegmentGeometryScratch {
    return readSegmentGeometry(
      this.topology,
      regionId,
      port1Id,
      port2Id,
      this.segmentGeometryScratch,
    )
  }

  appendSegmentToRegionCache(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ) {
    const netId = this.getCurrentRouteNetId()
    const segmentGeometry = this.populateSegmentGeometryScratch(
      regionId,
      port1Id,
      port2Id,
    )
    const regionCache = this.getMutableRegionCache(regionId)
    const delta = regionCache.countDelta(netId, segmentGeometry)

    this.state.regionIntersectionCaches[regionId] = regionCache.append(
      netId,
      segmentGeometry,
      delta,
      (
        sameLayerIntersections,
        crossingLayerIntersections,
        entryExitLayerChanges,
        segmentCount,
      ) =>
        this.computeRegionCostForRegion(
          regionId,
          sameLayerIntersections,
          crossingLayerIntersections,
          entryExitLayerChanges,
          segmentCount,
        ),
    )
  }

  private createRegionCachesFromState(): MutableRegionCache[] {
    return this.state.regionIntersectionCaches.map((cache) =>
      MutableRegionCache.from(cache),
    )
  }

  private getMutableRegionCache(regionId: RegionId): MutableRegionCache {
    const visibleCache = this.state.regionIntersectionCaches[regionId]
    if (!visibleCache) {
      throw new Error(`Region cache ${regionId} is missing`)
    }

    const existingCache = this.regionCaches[regionId]
    if (existingCache?.owns(visibleCache)) {
      return existingCache
    }

    const nextCache = MutableRegionCache.from(visibleCache)
    this.regionCaches[regionId] = nextCache
    return nextCache
  }

  private getCurrentRouteNetId(): NetId {
    const netId = this.state.currentRouteNetId
    if (netId === undefined) {
      throw new Error("Cannot read current route net before a route is active")
    }

    return netId
  }
  getSolvedPathSegments(finalCandidate: Candidate): Array<{
    regionId: RegionId
    fromPortId: PortId
    toPortId: PortId
  }> {
    const { state } = this
    const candidatePath: Candidate[] = []
    let cursor: Candidate | undefined = finalCandidate

    while (cursor) {
      candidatePath.unshift(cursor)
      cursor = cursor.prevCandidate
    }

    const solvedSegments: Array<{
      regionId: RegionId
      fromPortId: PortId
      toPortId: PortId
    }> = []

    for (let i = 1; i < candidatePath.length; i++) {
      solvedSegments.push({
        regionId: candidatePath[i - 1].nextRegionId,
        fromPortId: candidatePath[i - 1].portId,
        toPortId: candidatePath[i].portId,
      })
    }

    const lastCandidate = candidatePath[candidatePath.length - 1]
    if (lastCandidate && lastCandidate.portId !== state.goalPortId) {
      solvedSegments.push({
        regionId: lastCandidate.nextRegionId,
        fromPortId: lastCandidate.portId,
        toPortId: state.goalPortId,
      })
    }

    return solvedSegments
  }

  resetRoutingStateForRerip() {
    const { topology, problem, state } = this

    state.portAssignment.fill(-1)
    state.regionSegments = Array.from(
      { length: topology.regionCount },
      () => [],
    )
    state.regionIntersectionCaches = Array.from(
      { length: topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    state.currentRouteNetId = undefined
    state.currentRouteId = undefined
    state.unroutedRoutes = shuffle(range(problem.routeCount), state.ripCount)
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    state.goalPortId = -1
    this.regionCaches = this.createRegionCachesFromState()
    this.layeredSearchAllowedFineRegionMask = undefined
  }

  protected getMaxRegionCost() {
    const { topology, state } = this
    let maxRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost = getExistingRegionCost(
        state.regionIntersectionCaches,
        regionId,
      )
      maxRegionCost = Math.max(maxRegionCost, regionCost)
    }

    return maxRegionCost
  }

  protected getRouteMetadata(routeId: RouteId):
    | {
        connectionId?: unknown
        startRegionId?: unknown
        endRegionId?: unknown
        simpleRouteConnection?: {
          pointsToConnect?: Array<{
            pointId?: unknown
          }>
        }
      }
    | undefined {
    return this.problem.routeMetadata?.[routeId] as
      | {
          connectionId?: unknown
          startRegionId?: unknown
          endRegionId?: unknown
          simpleRouteConnection?: {
            pointsToConnect?: Array<{
              pointId?: unknown
            }>
          }
        }
      | undefined
  }

  protected getRouteConnectionId(routeId: RouteId) {
    const connectionId = this.getRouteMetadata(routeId)?.connectionId
    if (typeof connectionId === "string") return connectionId

    throw new SolverInvariantError(routeId, "missing route connectionId metadata")
  }

  protected getRouteSummary(
    routeId: RouteId,
  ): StaticallyUnroutableRouteSummary {
    return createStaticallyUnroutableRouteSummary({
      problem: this.problem,
      routeId,
      getRouteMetadata: (currentRouteId) =>
        this.getRouteMetadata(currentRouteId),
      getRouteConnectionId: (currentRouteId) =>
        this.getRouteConnectionId(currentRouteId),
    })
  }

  getAdditionalRegionLabel(_regionId: RegionId): string | undefined {
    return undefined
  }

  getNeverSuccessfullyRoutedRoutes(): NeverSuccessfullyRoutedRouteSummary[] {
    const neverSuccessfullyRoutedRoutes: NeverSuccessfullyRoutedRouteSummary[] =
      []

    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const attempts = this.routeAttemptCountByRouteId[routeId]!
      if (attempts === 0 || this.routeSuccessCountByRouteId[routeId]! > 0) {
        continue
      }

      neverSuccessfullyRoutedRoutes.push({
        ...this.getRouteSummary(routeId),
        attempts,
      })
    }

    return neverSuccessfullyRoutedRoutes
  }

  getStaticallyUnroutableRoutes(): StaticallyUnroutableRouteSummary[] {
    return this.staticallyUnroutableRoutes
  }

  protected logNeverSuccessfullyRoutedRoutes() {
    if (!this.VERBOSE || this.hasLoggedNeverSuccessfullyRoutedRoutes) {
      return
    }

    const neverSuccessfullyRoutedRoutes =
      this.getNeverSuccessfullyRoutedRoutes()
    this.hasLoggedNeverSuccessfullyRoutedRoutes = true

    if (neverSuccessfullyRoutedRoutes.length === 0) {
      return
    }

    console.log(
      [
        "[TinyHyperGraphSolver2:never-routed-summary]",
        `count=${neverSuccessfullyRoutedRoutes.length}`,
      ].join(" "),
    )

    for (const neverSuccessfullyRoutedRoute of neverSuccessfullyRoutedRoutes) {
      const pointPath =
        neverSuccessfullyRoutedRoute.pointIds.length >= 2
          ? `${neverSuccessfullyRoutedRoute.pointIds[0]}->${neverSuccessfullyRoutedRoute.pointIds[1]}`
          : "unknown"

      console.log(
        [
          "[TinyHyperGraphSolver2:never-routed]",
          `routeId=${neverSuccessfullyRoutedRoute.routeId}`,
          `connectionId=${neverSuccessfullyRoutedRoute.connectionId}`,
          `attempts=${neverSuccessfullyRoutedRoute.attempts}`,
          `pointPath=${pointPath}`,
          `startRegionId=${neverSuccessfullyRoutedRoute.startRegionId ?? "unknown"}`,
          `endRegionId=${neverSuccessfullyRoutedRoute.endRegionId ?? "unknown"}`,
        ].join(" "),
      )
    }
  }

  protected logRipEvent(
    reason: "hot_regions" | "out_of_candidates",
    maxRegionCostBeforeRip: number,
    extraFields: Record<string, string | number> = {},
  ) {
    if (!this.VERBOSE) {
      return
    }

    console.log(
      [
        "[TinyHyperGraphSolver2:rip]",
        `ripCount=${this.state.ripCount}`,
        `maxRegionCostBeforeRip=${maxRegionCostBeforeRip.toFixed(3)}`,
        `reason=${reason}`,
        ...Object.entries(extraFields).map(
          ([key, value]) =>
            `${key}=${
              typeof value === "number"
                ? Number.isInteger(value)
                  ? String(value)
                  : value.toFixed(3)
                : value
            }`,
        ),
      ].join(" "),
    )
  }

  protected compareRegionCostSummaries(
    left: RegionCostSummary,
    right: RegionCostSummary,
  ) {
    if (left.maxRegionCost !== right.maxRegionCost) {
      return left.maxRegionCost - right.maxRegionCost
    }

    return left.totalRegionCost - right.totalRegionCost
  }

  protected captureBestSolvedState(summary: RegionCostSummary) {
    if (
      this.bestSolvedStateSummary &&
      this.compareRegionCostSummaries(summary, this.bestSolvedStateSummary) >= 0
    ) {
      return
    }

    this.bestSolvedStateSummary = summary
    this.bestSolvedStateSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
      regionCongestionCost: this.state.regionCongestionCost,
      ripCount: this.state.ripCount,
    })
  }

  protected restoreBestSolvedState() {
    if (!this.bestSolvedStateSnapshot) {
      return
    }

    const snapshot = cloneSolvedStateSnapshot(this.bestSolvedStateSnapshot)
    this.state.portAssignment = snapshot.portAssignment
    this.state.regionSegments = snapshot.regionSegments
    this.state.regionIntersectionCaches = snapshot.regionIntersectionCaches
    this.state.regionCongestionCost = snapshot.regionCongestionCost
    this.state.ripCount = snapshot.ripCount
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    this.regionCaches = this.createRegionCachesFromState()
  }

  protected getRemainingRouteIdsForGreedyFinalRoute(): RouteId[] {
    const routeIds = new Set<RouteId>(this.state.unroutedRoutes)

    if (this.state.currentRouteId !== undefined) {
      routeIds.add(this.state.currentRouteId)
    }

    return [...routeIds]
  }

  protected applySnapshotToGreedyFinalRouteSolver(
    solver: TinyHyperGraphSolver2,
    snapshot: SolvedStateSnapshot,
    routeIds: RouteId[],
  ) {
    const clonedSnapshot = cloneSolvedStateSnapshot(snapshot)

    solver.state.portAssignment = clonedSnapshot.portAssignment
    solver.state.regionSegments = clonedSnapshot.regionSegments
    solver.state.regionIntersectionCaches =
      clonedSnapshot.regionIntersectionCaches
    solver.state.regionCongestionCost = clonedSnapshot.regionCongestionCost
    solver.state.ripCount = 0
    solver.state.currentRouteId = undefined
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = [...routeIds]
    solver.state.candidateQueue.clear()
    solver.resetCandidateBestCosts()
    solver.state.goalPortId = -1
  }

  protected summarizeSolvedState(
    solver: TinyHyperGraphSolver2,
  ): RegionCostSummary {
    let maxRegionCost = 0
    let totalRegionCost = 0

    for (const regionIntersectionCache of solver.state
      .regionIntersectionCaches) {
      const regionCost = regionIntersectionCache.existingRegionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost
    }

    return {
      maxRegionCost,
      totalRegionCost,
    }
  }

  protected tryGreedyFinalRouteAcceptance(): boolean {
    const greedyFinalRouteIters = Math.max(
      0,
      Math.floor(this.GREEDY_FINAL_ROUTE_ITERS),
    )
    if (greedyFinalRouteIters === 0) {
      return false
    }

    const remainingRouteIds = this.getRemainingRouteIdsForGreedyFinalRoute()
    if (remainingRouteIds.length === 0) {
      return false
    }

    const startingSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
      regionCongestionCost: this.state.regionCongestionCost,
      ripCount: this.state.ripCount,
    })

    for (
      let greedyFinalRouteIter = 0;
      greedyFinalRouteIter < greedyFinalRouteIters;
      greedyFinalRouteIter++
    ) {
      const routeIds =
        greedyFinalRouteIter === 0
          ? remainingRouteIds
          : shuffle(
              remainingRouteIds,
              this.state.ripCount + greedyFinalRouteIter,
            )
      const greedySolver = new GreedyFinalRouteSolver(
        this.topology,
        this.problem,
        {
          ...getTinyHyperGraphSolver2Options(this),
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
          GREEDY_FINAL_ROUTE_ITERS: 0,
          MAX_ITERATIONS: GREEDY_FINAL_ROUTE_MAX_ITERATIONS,
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          STATIC_REACHABILITY_PRECHECK: false,
        },
      )

      this.applySnapshotToGreedyFinalRouteSolver(
        greedySolver,
        startingSnapshot,
        routeIds,
      )
      greedySolver.solve()

      if (!greedySolver.solved || greedySolver.failed) {
        continue
      }

      this.bestSolvedStateSnapshot = cloneSolvedStateSnapshot({
        portAssignment: greedySolver.state.portAssignment,
        regionSegments: greedySolver.state.regionSegments,
        regionIntersectionCaches: greedySolver.state.regionIntersectionCaches,
        regionCongestionCost: greedySolver.state.regionCongestionCost,
        ripCount: greedySolver.state.ripCount,
      })
      this.bestSolvedStateSummary = this.summarizeSolvedState(greedySolver)
      this.restoreBestSolvedState()
      this.stats = {
        ...this.stats,
        acceptedGreedyFinalRouteOnTimeout: true,
        greedyFinalRouteIter,
        greedyFinalRouteRemainingRouteCount: remainingRouteIds.length,
        greedyFinalRouteMaxIterations: GREEDY_FINAL_ROUTE_MAX_ITERATIONS,
        neverSuccessfullyRoutedRouteCount: 0,
        maxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
        totalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
        bestMaxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
        bestTotalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
      }
      this.solved = true
      this.failed = false
      this.error = null
      return true
    }

    this.stats = {
      ...this.stats,
      greedyFinalRouteAttemptCount: greedyFinalRouteIters,
      greedyFinalRouteRemainingRouteCount: remainingRouteIds.length,
      greedyFinalRouteMaxIterations: GREEDY_FINAL_ROUTE_MAX_ITERATIONS,
    }

    return false
  }

  onAllRoutesRouted() {
    const { topology, state } = this
    const ripThresholdProgress =
      this.RIP_THRESHOLD_RAMP_ATTEMPTS <= 0
        ? 1
        : Math.min(1, state.ripCount / this.RIP_THRESHOLD_RAMP_ATTEMPTS)
    const currentRipThreshold =
      this.RIP_THRESHOLD_START +
      (this.RIP_THRESHOLD_END - this.RIP_THRESHOLD_START) * ripThresholdProgress

    const regionIdsOverCostThreshold: RegionId[] = []
    const regionCosts = new Float64Array(topology.regionCount)
    let maxRegionCost = 0
    let totalRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost = getExistingRegionCost(
        state.regionIntersectionCaches,
        regionId,
      )
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost

      if (regionCost > currentRipThreshold) {
        regionIdsOverCostThreshold.push(regionId)
      }
    }

    this.captureBestSolvedState({
      maxRegionCost,
      totalRegionCost,
    })

    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: regionIdsOverCostThreshold.length,
      maxRegionCost,
      totalRegionCost,
      bestMaxRegionCost: this.bestSolvedStateSummary?.maxRegionCost,
      bestTotalRegionCost: this.bestSolvedStateSummary?.totalRegionCost,
      ripCount: state.ripCount,
    }

    if (
      regionIdsOverCostThreshold.length === 0 ||
      state.ripCount >= this.RIP_THRESHOLD_RAMP_ATTEMPTS
    ) {
      this.solved = true
      return
    }

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      state.regionCongestionCost[regionId] +=
        regionCosts[regionId] * this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    state.ripCount += 1
    this.resetRoutingStateForRerip()
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      maxRegionCostBeforeRip: maxRegionCost,
      reripRegionCount: regionIdsOverCostThreshold.length,
    }
    this.logRipEvent("hot_regions", maxRegionCost, {
      hotRegionCount: regionIdsOverCostThreshold.length,
      currentRipThreshold,
    })
  }

  onOutOfCandidates() {
    const { topology, state } = this
    const currentRouteId = state.currentRouteId
    const maxRegionCostBeforeRip = this.getMaxRegionCost()

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost = getExistingRegionCost(
        state.regionIntersectionCaches,
        regionId,
      )
      state.regionCongestionCost[regionId] +=
        regionCost * this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    state.ripCount += 1
    this.resetRoutingStateForRerip()
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      maxRegionCost: maxRegionCostBeforeRip,
      maxRegionCostBeforeRip,
      reripReason: "out_of_candidates",
    }
    this.logRipEvent("out_of_candidates", maxRegionCostBeforeRip, {
      ...(currentRouteId === undefined
        ? {}
        : {
            routeId: currentRouteId,
            connectionId: this.getRouteConnectionId(currentRouteId),
          }),
    })
  }

  onPathFound(finalCandidate: Candidate) {
    const { state } = this
    const currentRouteId = state.currentRouteId

    if (currentRouteId === undefined) return
    this.routeSuccessCountByRouteId[currentRouteId] += 1

    const solvedSegments = this.getSolvedPathSegments(finalCandidate)

    for (const { regionId, fromPortId, toPortId } of solvedSegments) {
      state.regionSegments[regionId].push([
        currentRouteId,
        fromPortId,
        toPortId,
      ])
      state.portAssignment[fromPortId] = state.currentRouteNetId!
      state.portAssignment[toPortId] = state.currentRouteNetId!
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }

    state.candidateQueue.clear()
    state.currentRouteNetId = undefined
    state.currentRouteId = undefined
    this.layeredSearchAllowedFineRegionMask = undefined
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const nextRegionId = currentCandidate.nextRegionId
    const segmentGeometry = this.populateSegmentGeometryScratch(
      nextRegionId,
      currentCandidate.portId,
      neighborPortId,
    )
    const regionCache = this.getMutableRegionCache(nextRegionId)
    const delta = regionCache.countDelta(
      this.getCurrentRouteNetId(),
      segmentGeometry,
    )

    if (
      delta.sameLayerIntersections > 0 &&
      this.isKnownSingleLayerRegion(nextRegionId)
    ) {
      return Number.POSITIVE_INFINITY
    }

    const newRegionCost =
      this.computeRegionCostForRegion(
        nextRegionId,
        regionCache.sameLayerIntersections + delta.sameLayerIntersections,
        regionCache.crossingLayerIntersections +
          delta.crossingLayerIntersections,
        regionCache.entryExitLayerChanges + delta.entryExitLayerChanges,
        regionCache.committedSegmentCount + 1,
      ) - regionCache.regionCost

    return (
      currentCandidate.g +
      newRegionCost +
      this.state.regionCongestionCost[nextRegionId] +
      (this.problem.portPenalty?.[neighborPortId] ?? 0)
    )
  }

  override tryFinalAcceptance() {
    const neverSuccessfullyRoutedRoutes =
      this.getNeverSuccessfullyRoutedRoutes()

    this.stats = {
      ...this.stats,
      neverSuccessfullyRoutedRouteCount: neverSuccessfullyRoutedRoutes.length,
    }

    if (
      this.ACCEPT_BEST_SOLUTION_ON_TIMEOUT &&
      this.bestSolvedStateSnapshot &&
      this.bestSolvedStateSummary
    ) {
      this.restoreBestSolvedState()
      this.stats = {
        ...this.stats,
        acceptedBestSolutionOnTimeout: true,
        maxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
        totalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
        bestMaxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
        bestTotalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
      }
      this.solved = true
      this.failed = false
      this.error = null
      return
    }

    if (
      this.ACCEPT_BEST_SOLUTION_ON_TIMEOUT &&
      this.tryGreedyFinalRouteAcceptance()
    ) {
      return
    }

    this.logNeverSuccessfullyRoutedRoutes()
  }

  computeH(neighborPortId: PortId): number {
    const precomputedHCost = this.problemSetup.portHCostToEndOfRoute
    if (precomputedHCost) {
      return precomputedHCost[
        neighborPortId * this.problem.routeCount + this.state.currentRouteId!
      ]
    }

    const endPortId = this.problem.routeEndPort[this.state.currentRouteId!]
    const dx =
      this.topology.portX[neighborPortId] - this.topology.portX[endPortId]
    const dy =
      this.topology.portY[neighborPortId] - this.topology.portY[endPortId]
    return Math.hypot(dx, dy) * this.DISTANCE_TO_COST
  }

  /**
   * Run the solver and return expected solve failures as values.
   *
   * @returns The current solver on success, or a typed solve error.
   */
  solveResult(): Result<this, SolveGraphError> {
    try {
      this.solve()
    } catch (cause) {
      return err(
        new SolveGraphError(
          cause instanceof Error ? cause.message : String(cause),
          this.stats,
          cause,
        ),
      )
    }

    if (!this.solved || this.failed) {
      return err(
        new SolveGraphError(this.error ?? "solver did not finish", this.stats),
      )
    }

    return ok(this)
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this)
  }

  override getOutput() {
    return convertToSerializedHyperGraph(this)
  }
}

class GreedyFinalRouteSolver extends TinyHyperGraphSolver2 {
  override computeG(
    currentCandidate: Candidate,
    _neighborPortId: PortId,
  ): number {
    return currentCandidate.g
  }
}

/** Expected failure produced while running a lib2 solve. */
export class SolveGraphError extends Error {
  readonly _tag = "SolveGraphError"
  readonly errorCause: unknown | undefined

  constructor(
    readonly reason: string,
    readonly stats: Record<string, unknown>,
    errorCause?: unknown,
  ) {
    super(`Unable to solve graph: ${reason}`)
    this.errorCause = errorCause
  }
}

/** Successful serialized solve output. */
export type SolvedGraph = {
  readonly solver: TinyHyperGraphSolver2
  readonly graph: SerializedHyperGraph
}

/**
 * Create a lib2 solver from loaded topology and problem data.
 *
 * @param topology - Loaded graph topology.
 * @param problem - Loaded routing problem.
 * @param options - Optional solver parameters.
 * @returns A lib2 solver instance.
 */
export function createSolver(
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options?: TinyHyperGraphSolver2Options,
): TinyHyperGraphSolver2 {
  return new TinyHyperGraphSolver2(topology, problem, options)
}

/**
 * Parse, load, solve, and serialize a graph through the lib2 boundary.
 *
 * @param graph - Unknown serialized graph input.
 * @param options - Optional solver parameters.
 * @returns A solved serialized graph or a typed expected failure.
 */
export function solveGraph(
  graph: unknown,
  options?: TinyHyperGraphSolver2Options,
): Result<SolvedGraph, ParseGraphError | LoadGraphError | SolveGraphError> {
  const parsedGraphResult = parseGraph(graph)
  if (parsedGraphResult._tag === "err") {
    return parsedGraphResult
  }

  const loadedGraphResult = loadGraph(parsedGraphResult.value)
  if (loadedGraphResult._tag === "err") {
    return loadedGraphResult
  }

  const solver = createSolver(
    loadedGraphResult.value.topology,
    loadedGraphResult.value.problem,
    options,
  )
  const solveResult = solver.solveResult()
  if (solveResult._tag === "err") {
    return solveResult
  }

  try {
    return ok({
      solver,
      graph: solver.getOutput(),
    })
  } catch (cause) {
    return err(
        new SolveGraphError(
          cause instanceof Error ? cause.message : String(cause),
          solver.stats,
          cause,
        ),
      )
  }
}
