import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import {
  computeRegionCost,
  DEFAULT_MIN_VIA_PAD_DIAMETER,
  isKnownSingleLayerMask,
} from "./computeRegionCost"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import { MinHeap } from "./MinHeap"
import { shuffle } from "./shuffle"
import type { StaticallyUnroutableRouteSummary } from "./static-reachability"
import {
  createStaticallyUnroutableRouteSummary,
  getStaticallyUnroutableRoutes,
  getStaticReachabilityError,
} from "./static-reachability"
import type {
  HopId,
  NetId,
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "./types"
import { range } from "./utils"
import { visualizeTinyGraph } from "./visualizeTinyGraph"

export type { StaticallyUnroutableRouteSummary } from "./static-reachability"

const GREEDY_FINAL_ROUTE_MAX_ITERATIONS = 50e3

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

export interface TinyHyperGraphTopology {
  portCount: number
  regionCount: number

  /** regionIncidentPorts[regionId] = list of port ids incident to the region */
  regionIncidentPorts: PortId[][]

  /** incidentPortRegion[portId] = list of region ids incident to the port */
  incidentPortRegion: RegionId[][]

  regionWidth: Float64Array
  regionHeight: Float64Array
  regionCenterX: Float64Array
  regionCenterY: Float64Array
  /**
   * regionAvailableZMask[regionId] is a bitmask of the routed layers available
   * within the region. A zero mask means "unknown", which preserves legacy cost
   * behavior for manually-constructed topologies that do not provide this data.
   */
  regionAvailableZMask?: Int32Array

  /** regionMetadata[regionId] = metadata for the region */
  regionMetadata?: any[]

  /** portAngleForRegion1[portId] = CCW angle of the port on incidentPortRegion[portId][0], where 0 is the right side and 9000 is the top */
  portAngleForRegion1: Int32Array
  /** portAngleForRegion2[portId] = CCW angle of the port on incidentPortRegion[portId][1] */
  portAngleForRegion2?: Int32Array
  portX: Float64Array
  portY: Float64Array
  portZ: Int32Array

  portMetadata?: any[]
}
export interface TinyHyperGraphProblem {
  routeCount: number

  /**
   * portSectionMask[portId] = true if port in section
   * Only ports within a section can be explored to solve the problem
   **/
  portSectionMask: Int8Array // boolean[], length: portCount

  /** routeMetadata[routeId] = metadata for the route */
  routeMetadata?: any[]

  /** routeStartRegion[routeId] = list of port ids at the start of the route */
  routeStartPort: Int32Array // PortId[]
  routeEndPort: Int32Array // PortId[]

  // routeNet[routeId] = net id of the route
  routeNet: Int32Array // NetId[]
  /** regionNetId[regionId] = reserved net id for the region, -1 means freely traversable */
  regionNetId: Int32Array

  /** portPenalty[portId] = extra cost paid when a route traverses the port */
  portPenalty?: Float64Array
}

export interface TinyHyperGraphProblemSetup {
  // portHCostToEndOfRoute[portId * routeCount + routeId] = distance from port to end of route
  portHCostToEndOfRoute: Float64Array
  portEndpointNetIds: Array<Set<NetId>>
}

export interface TinyHyperGraphSolution {
  /** solvedRoutePathSegments[routeId] = list of segments, each segment is an ordered list of port ids in the route */
  solvedRoutePathSegments: Array<[PortId, PortId][]>
  /**
   * solvedRoutePathRegionIds[routeId][segmentIndex] = explicit region id for
   * solvedRoutePathSegments[routeId][segmentIndex], when known from serialized
   * route data. This preserves exact routed regions for replay instead of
   * inferring from the port pair.
   */
  solvedRoutePathRegionIds?: Array<Array<RegionId | undefined>>
}

export interface RegionCostSummary {
  maxRegionCost: number
  totalRegionCost: number
}

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

export interface Candidate {
  prevRegionId?: RegionId
  portId: PortId
  nextRegionId: RegionId

  prevCandidate?: Candidate

  f: number
  g: number
  h: number
}

export interface TinyHyperGraphWorkingState {
  // portAssignment[portId] = NetId, -1 means unassigned
  portAssignment: Int32Array

  // regionSegments[regionId] = Array<Route Assignment and Two Ports>
  regionSegments: Array<[RouteId, PortId, PortId][]>

  // regionIntersectionCache[regionId] = DynamicAnglePairArrays
  regionIntersectionCaches: RegionIntersectionCache[]

  currentRouteNetId: NetId | undefined
  currentRouteId: RouteId | undefined

  unroutedRoutes: RouteId[]

  candidateQueue: MinHeap<Candidate>
  candidateBestCostByHopId: Float64Array | Map<HopId, number>
  candidateBestCostGenerationByHopId: Uint32Array | Map<HopId, number>
  candidateBestCostGeneration: number

  goalPortId: PortId

  ripCount: number

  /** regionCongestionCost[regionId] = congestion cost */
  regionCongestionCost: Float64Array
}

export interface TinyHyperGraphSolverOptions {
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
  ACCEPT_FIRST_COMPLETE_SOLUTION?: boolean
  EARLY_GREEDY_COMPLETION?: boolean
  GREEDY_COMPLETION_INTERVAL?: number
  MAX_GREEDY_COMPLETION_STALLS?: number
  MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE?: number
  MAX_GREEDY_COMPLETION_MISSES?: number
  FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST?: boolean
  MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION?: number
  MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION?: number
}

export interface TinyHyperGraphSolverOptionTarget {
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
  ACCEPT_FIRST_COMPLETE_SOLUTION: boolean
  EARLY_GREEDY_COMPLETION: boolean
  GREEDY_COMPLETION_INTERVAL: number
  MAX_GREEDY_COMPLETION_STALLS: number
  MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE: number
  MAX_GREEDY_COMPLETION_MISSES: number
  FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST: boolean
  MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION: number
  MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION: number
}

export const applyTinyHyperGraphSolverOptions = (
  solver: TinyHyperGraphSolverOptionTarget,
  options?: TinyHyperGraphSolverOptions,
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
  if (options.ACCEPT_FIRST_COMPLETE_SOLUTION !== undefined) {
    solver.ACCEPT_FIRST_COMPLETE_SOLUTION =
      options.ACCEPT_FIRST_COMPLETE_SOLUTION
  }
  if (options.EARLY_GREEDY_COMPLETION !== undefined) {
    solver.EARLY_GREEDY_COMPLETION = options.EARLY_GREEDY_COMPLETION
  }
  if (options.GREEDY_COMPLETION_INTERVAL !== undefined) {
    solver.GREEDY_COMPLETION_INTERVAL = options.GREEDY_COMPLETION_INTERVAL
  }
  if (options.MAX_GREEDY_COMPLETION_STALLS !== undefined) {
    solver.MAX_GREEDY_COMPLETION_STALLS =
      options.MAX_GREEDY_COMPLETION_STALLS
  }
  if (
    options.MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE !==
    undefined
  ) {
    solver.MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE =
      options.MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE
  }
  if (options.MAX_GREEDY_COMPLETION_MISSES !== undefined) {
    solver.MAX_GREEDY_COMPLETION_MISSES =
      options.MAX_GREEDY_COMPLETION_MISSES
  }
  if (
    options.FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST !== undefined
  ) {
    solver.FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST =
      options.FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST
  }
  if (
    options.MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION !== undefined
  ) {
    solver.MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION =
      options.MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION
  }
  if (
    options.MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION !== undefined
  ) {
    solver.MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION =
      options.MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION
  }
}

export const getTinyHyperGraphSolverOptions = (
  solver: TinyHyperGraphSolverOptionTarget,
): TinyHyperGraphSolverOptions => ({
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
  ACCEPT_FIRST_COMPLETE_SOLUTION: solver.ACCEPT_FIRST_COMPLETE_SOLUTION,
  EARLY_GREEDY_COMPLETION: solver.EARLY_GREEDY_COMPLETION,
  GREEDY_COMPLETION_INTERVAL: solver.GREEDY_COMPLETION_INTERVAL,
  MAX_GREEDY_COMPLETION_STALLS: solver.MAX_GREEDY_COMPLETION_STALLS,
  MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE:
    solver.MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE,
  MAX_GREEDY_COMPLETION_MISSES: solver.MAX_GREEDY_COMPLETION_MISSES,
  FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST:
    solver.FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST,
  MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION:
    solver.MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION,
  MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION:
    solver.MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION,
})

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f

interface SegmentGeometryScratch {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  private _problemSetup?: TinyHyperGraphProblemSetup
  protected routeAttemptCountByRouteId: Uint32Array
  protected routeSuccessCountByRouteId: Uint32Array
  protected routeOutOfCandidatesCountByRouteId: Uint32Array
  protected bestSolvedStateSnapshot?: SolvedStateSnapshot
  protected bestSolvedStateSummary?: RegionCostSummary
  protected greedyCompletionStallCount = 0
  protected greedyCompletionMissCount = 0
  protected greedyCompletionAttemptCount = 0
  protected greedyCompletionSuccessCount = 0
  private lastGreedyCompletionIteration = 0
  private hasLoggedNeverSuccessfullyRoutedRoutes = false
  private staticallyUnroutableRoutes: StaticallyUnroutableRouteSummary[] = []
  private segmentGeometryScratch: SegmentGeometryScratch = {
    lesserAngle: 0,
    greaterAngle: 0,
    layerMask: 0,
    entryExitLayerChanges: 0,
  }

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
  ACCEPT_FIRST_COMPLETE_SOLUTION = false
  EARLY_GREEDY_COMPLETION = false
  GREEDY_COMPLETION_INTERVAL = 100_000
  MAX_GREEDY_COMPLETION_STALLS = Number.POSITIVE_INFINITY
  MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE = 0
  MAX_GREEDY_COMPLETION_MISSES = Number.POSITIVE_INFINITY
  FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST = false
  MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION =
    Number.POSITIVE_INFINITY
  MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION =
    Number.POSITIVE_INFINITY

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super()
    applyTinyHyperGraphSolverOptions(this, options)
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
    this.routeOutOfCandidatesCountByRouteId = new Uint32Array(
      problem.routeCount,
    )
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
  }

  override _step() {
    const { problem, topology, state } = this

    if (state.currentRouteId === undefined) {
      if (state.unroutedRoutes.length === 0) {
        this.onAllRoutesRouted()
        return
      }

      state.currentRouteId = state.unroutedRoutes.shift()
      state.currentRouteNetId = problem.routeNet[state.currentRouteId!]
      this.routeAttemptCountByRouteId[state.currentRouteId!] += 1

      this.resetCandidateBestCosts()
      const startingPortId = problem.routeStartPort[state.currentRouteId!]
      state.candidateQueue.clear()
      const startingNextRegionId = this.getStartingNextRegionId(
        state.currentRouteId!,
        startingPortId,
      )

      if (startingNextRegionId === undefined) {
        this.failed = true
        this.error = `Start port ${startingPortId} has no incident regions`
        return
      }

      this.setCandidateBestCost(
        this.getHopId(startingPortId, startingNextRegionId),
        0,
      )
      state.candidateQueue.queue({
        nextRegionId: startingNextRegionId,
        portId: startingPortId,
        f: 0,
        g: 0,
        h: 0,
      })
      state.goalPortId = problem.routeEndPort[state.currentRouteId!]
    }

    const currentCandidate = state.candidateQueue.dequeue()

    if (!currentCandidate) {
      this.onOutOfCandidates()
      return
    }

    const currentCandidateHopId = this.getHopId(
      currentCandidate.portId,
      currentCandidate.nextRegionId,
    )
    if (currentCandidate.g > this.getCandidateBestCost(currentCandidateHopId)) {
      return
    }

    if (this.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) {
      return
    }

    const neighbors =
      topology.regionIncidentPorts[currentCandidate.nextRegionId]

    for (const neighborPortId of neighbors) {
      const assignedNetId = state.portAssignment[neighborPortId]
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (neighborPortId === state.goalPortId) {
        if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
          continue
        }
        this.onPathFound(currentCandidate)
        return
      }
      if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
        continue
      }
      if (neighborPortId === currentCandidate.portId) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue

      const g = this.computeG(currentCandidate, neighborPortId)
      if (!Number.isFinite(g)) continue
      const h = this.computeH(neighborPortId)

      const nextRegionId =
        topology.incidentPortRegion[neighborPortId][0] ===
        currentCandidate.nextRegionId
          ? topology.incidentPortRegion[neighborPortId][1]
          : topology.incidentPortRegion[neighborPortId][0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNet(nextRegionId)
      ) {
        continue
      }

      const newCandidate = {
        prevRegionId: currentCandidate.nextRegionId,
        nextRegionId,
        portId: neighborPortId,
        g,
        h,
        f: g + h,
        prevCandidate: currentCandidate,
      }

      if (neighborPortId === state.goalPortId) {
        this.onPathFound(newCandidate)
        return
      }

      const candidateHopId = this.getHopId(neighborPortId, nextRegionId)
      if (g >= this.getCandidateBestCost(candidateHopId)) continue

      this.setCandidateBestCost(candidateHopId, g)
      state.candidateQueue.queue(newCandidate)
    }

    this.maybeRunScheduledGreedyCompletion()
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
      ) ??
      startingIncidentRegions[0]
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
    const { topology } = this
    const scratch = this.segmentGeometryScratch
    const port1IncidentRegions = topology.incidentPortRegion[port1Id]
    const port2IncidentRegions = topology.incidentPortRegion[port2Id]
    const angle1 =
      port1IncidentRegions[0] === regionId ||
      port1IncidentRegions[1] !== regionId
        ? topology.portAngleForRegion1[port1Id]
        : (topology.portAngleForRegion2?.[port1Id] ??
          topology.portAngleForRegion1[port1Id])
    const angle2 =
      port2IncidentRegions[0] === regionId ||
      port2IncidentRegions[1] !== regionId
        ? topology.portAngleForRegion1[port2Id]
        : (topology.portAngleForRegion2?.[port2Id] ??
          topology.portAngleForRegion1[port2Id])
    const z1 = topology.portZ[port1Id]
    const z2 = topology.portZ[port2Id]
    scratch.lesserAngle = angle1 < angle2 ? angle1 : angle2
    scratch.greaterAngle = angle1 < angle2 ? angle2 : angle1
    scratch.layerMask = (1 << z1) | (1 << z2)
    scratch.entryExitLayerChanges = z1 !== z2 ? 1 : 0

    return scratch
  }

  appendSegmentToRegionCache(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ) {
    const { state } = this
    const regionCache = state.regionIntersectionCaches[regionId]
    const segmentGeometry = this.populateSegmentGeometryScratch(
      regionId,
      port1Id,
      port2Id,
    )
    const [
      newSameLayerIntersections,
      newCrossLayerIntersections,
      newEntryExitLayerChanges,
    ] = countNewIntersectionsWithValues(
      regionCache,
      state.currentRouteNetId!,
      segmentGeometry.lesserAngle,
      segmentGeometry.greaterAngle,
      segmentGeometry.layerMask,
      segmentGeometry.entryExitLayerChanges,
    )
    const nextLength = regionCache.netIds.length + 1

    const netIds = new Int32Array(nextLength)
    netIds.set(regionCache.netIds)
    netIds[nextLength - 1] = state.currentRouteNetId!

    const lesserAngles = new Int32Array(nextLength)
    lesserAngles.set(regionCache.lesserAngles)
    lesserAngles[nextLength - 1] = segmentGeometry.lesserAngle

    const greaterAngles = new Int32Array(nextLength)
    greaterAngles.set(regionCache.greaterAngles)
    greaterAngles[nextLength - 1] = segmentGeometry.greaterAngle

    const layerMasks = new Int32Array(nextLength)
    layerMasks.set(regionCache.layerMasks)
    layerMasks[nextLength - 1] = segmentGeometry.layerMask

    const existingSameLayerIntersections =
      regionCache.existingSameLayerIntersections + newSameLayerIntersections
    const existingCrossingLayerIntersections =
      regionCache.existingCrossingLayerIntersections +
      newCrossLayerIntersections
    const existingEntryExitLayerChanges =
      regionCache.existingEntryExitLayerChanges + newEntryExitLayerChanges
    const existingSegmentCount = lesserAngles.length

    state.regionIntersectionCaches[regionId] = {
      netIds,
      lesserAngles,
      greaterAngles,
      layerMasks,
      existingSameLayerIntersections,
      existingCrossingLayerIntersections,
      existingEntryExitLayerChanges,
      existingSegmentCount,
      existingRegionCost: this.computeRegionCostForRegion(
        regionId,
        existingSameLayerIntersections,
        existingCrossingLayerIntersections,
        existingEntryExitLayerChanges,
        existingSegmentCount,
      ),
    }
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
  }

  protected getMaxRegionCost() {
    const { topology, state } = this
    let maxRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
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
    return typeof connectionId === "string" ? connectionId : `route-${routeId}`
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
        "[TinyHyperGraphSolver:never-routed-summary]",
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
          "[TinyHyperGraphSolver:never-routed]",
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
        "[TinyHyperGraphSolver:rip]",
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

  protected captureBestSolvedState(
    summary: RegionCostSummary,
    snapshot?: SolvedStateSnapshot,
  ): boolean {
    if (
      this.bestSolvedStateSummary &&
      this.compareRegionCostSummaries(summary, this.bestSolvedStateSummary) >= 0
    ) {
      return false
    }

    this.bestSolvedStateSummary = summary
    this.bestSolvedStateSnapshot = cloneSolvedStateSnapshot(
      snapshot ?? {
        portAssignment: this.state.portAssignment,
        regionSegments: this.state.regionSegments,
        regionIntersectionCaches: this.state.regionIntersectionCaches,
        regionCongestionCost: this.state.regionCongestionCost,
        ripCount: this.state.ripCount,
      },
    )
    return true
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
  }

  protected getRemainingRouteIdsForGreedyFinalRoute(): RouteId[] {
    const routeIds = new Set<RouteId>(this.state.unroutedRoutes)

    if (this.state.currentRouteId !== undefined) {
      routeIds.add(this.state.currentRouteId)
    }

    return [...routeIds]
  }

  protected applySnapshotToGreedyFinalRouteSolver(
    solver: TinyHyperGraphSolver,
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
    solver: TinyHyperGraphSolver,
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

  protected getGreedyCompletionInterval() {
    return Math.max(0, Math.floor(this.GREEDY_COMPLETION_INTERVAL))
  }

  protected maybeRunScheduledGreedyCompletion(): boolean {
    if (!this.EARLY_GREEDY_COMPLETION) {
      return false
    }

    const greedyCompletionInterval = this.getGreedyCompletionInterval()
    if (greedyCompletionInterval === 0) {
      return false
    }

    if (
      this.iterations === this.lastGreedyCompletionIteration ||
      this.iterations % greedyCompletionInterval !== 0
    ) {
      return false
    }

    this.lastGreedyCompletionIteration = this.iterations
    return this.tryEarlyGreedyCompletion("interval")
  }

  protected shouldAcceptAfterGreedyCompletionStall() {
    return (
      this.bestSolvedStateSnapshot !== undefined &&
      this.iterations >=
        this.MIN_GREEDY_COMPLETION_ITERATIONS_BEFORE_STALL_ACCEPTANCE &&
      this.greedyCompletionStallCount >=
        this.MAX_GREEDY_COMPLETION_STALLS
    )
  }

  protected acceptBestSolvedState(reason: string) {
    if (!this.bestSolvedStateSnapshot || !this.bestSolvedStateSummary) {
      return false
    }

    this.restoreBestSolvedState()
    this.stats = {
      ...this.stats,
      acceptedBestSolutionEarly: true,
      acceptedBestSolutionReason: reason,
      maxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
      totalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
      bestMaxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
      bestTotalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
      greedyCompletionAttemptCount: this.greedyCompletionAttemptCount,
      greedyCompletionSuccessCount: this.greedyCompletionSuccessCount,
      greedyCompletionStallCount: this.greedyCompletionStallCount,
      greedyCompletionMissCount: this.greedyCompletionMissCount,
    }
    this.solved = true
    this.failed = false
    this.error = null
    return true
  }

  protected getSnapshotFromSolver(
    solver: TinyHyperGraphSolver,
  ): SolvedStateSnapshot {
    return {
      portAssignment: solver.state.portAssignment,
      regionSegments: solver.state.regionSegments,
      regionIntersectionCaches: solver.state.regionIntersectionCaches,
      regionCongestionCost: solver.state.regionCongestionCost,
      ripCount: solver.state.ripCount,
    }
  }

  protected captureGreedyCompletionCandidate(
    reason: "interval" | "out_of_candidates" | "timeout",
  ): {
    attempted: boolean
    found: boolean
    improved: boolean
  } {
    const greedyFinalRouteIters = Math.max(
      0,
      Math.floor(this.GREEDY_FINAL_ROUTE_ITERS),
    )
    if (greedyFinalRouteIters === 0) {
      return { attempted: false, found: false, improved: false }
    }

    const remainingRouteIds = this.getRemainingRouteIdsForGreedyFinalRoute()
    if (remainingRouteIds.length === 0) {
      return { attempted: false, found: false, improved: false }
    }

    const startingSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
      regionCongestionCost: this.state.regionCongestionCost,
      ripCount: this.state.ripCount,
    })
    let bestGreedySummary: RegionCostSummary | undefined
    let bestGreedySnapshot: SolvedStateSnapshot | undefined
    let bestGreedyIter = 0

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
          ...getTinyHyperGraphSolverOptions(this),
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
          ACCEPT_FIRST_COMPLETE_SOLUTION: true,
          EARLY_GREEDY_COMPLETION: false,
          GREEDY_FINAL_ROUTE_ITERS: 0,
          MAX_ITERATIONS: GREEDY_FINAL_ROUTE_MAX_ITERATIONS,
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          STATIC_REACHABILITY_PRECHECK: false,
        },
      )

      this.greedyCompletionAttemptCount += 1
      this.applySnapshotToGreedyFinalRouteSolver(
        greedySolver,
        startingSnapshot,
        routeIds,
      )
      greedySolver.solve()

      if (!greedySolver.solved || greedySolver.failed) {
        continue
      }

      this.greedyCompletionSuccessCount += 1
      const greedySummary = this.summarizeSolvedState(greedySolver)

      if (
        !bestGreedySummary ||
        this.compareRegionCostSummaries(greedySummary, bestGreedySummary) < 0
      ) {
        bestGreedySummary = greedySummary
        bestGreedySnapshot = this.getSnapshotFromSolver(greedySolver)
        bestGreedyIter = greedyFinalRouteIter
      }
    }

    if (!bestGreedySummary || !bestGreedySnapshot) {
      this.stats = {
        ...this.stats,
        greedyCompletionAttemptCount: this.greedyCompletionAttemptCount,
        greedyCompletionSuccessCount: this.greedyCompletionSuccessCount,
        greedyCompletionLastReason: reason,
        greedyCompletionLastFound: false,
        greedyCompletionRemainingRouteCount: remainingRouteIds.length,
      }
      return { attempted: true, found: false, improved: false }
    }

    const improved = this.captureBestSolvedState(
      bestGreedySummary,
      bestGreedySnapshot,
    )

    this.stats = {
      ...this.stats,
      greedyCompletionAttemptCount: this.greedyCompletionAttemptCount,
      greedyCompletionSuccessCount: this.greedyCompletionSuccessCount,
      greedyCompletionLastReason: reason,
      greedyCompletionLastFound: true,
      greedyCompletionLastImproved: improved,
      greedyCompletionLastIter: bestGreedyIter,
      greedyCompletionRemainingRouteCount: remainingRouteIds.length,
      greedyCompletionMaxRegionCost: bestGreedySummary.maxRegionCost,
      greedyCompletionTotalRegionCost: bestGreedySummary.totalRegionCost,
      bestMaxRegionCost: this.bestSolvedStateSummary?.maxRegionCost,
      bestTotalRegionCost: this.bestSolvedStateSummary?.totalRegionCost,
    }

    return { attempted: true, found: true, improved }
  }

  protected tryEarlyGreedyCompletion(
    reason: "interval" | "out_of_candidates",
  ): boolean {
    if (!this.EARLY_GREEDY_COMPLETION) {
      return false
    }
    if (this.greedyCompletionMissCount >= this.MAX_GREEDY_COMPLETION_MISSES) {
      return false
    }

    const result = this.captureGreedyCompletionCandidate(reason)
    if (!result.attempted) {
      return false
    }

    if (!result.found) {
      this.greedyCompletionMissCount += 1
    } else {
      this.greedyCompletionMissCount = 0
    }

    if (result.improved) {
      this.greedyCompletionStallCount = 0
    } else if (this.bestSolvedStateSnapshot) {
      this.greedyCompletionStallCount += 1
    }

    this.stats = {
      ...this.stats,
      greedyCompletionStallCount: this.greedyCompletionStallCount,
      greedyCompletionMissCount: this.greedyCompletionMissCount,
    }

    if (
      this.FAIL_AFTER_GREEDY_COMPLETION_MISSES_WITHOUT_BEST &&
      !this.bestSolvedStateSnapshot &&
      this.greedyCompletionMissCount >= this.MAX_GREEDY_COMPLETION_MISSES
    ) {
      this.failed = true
      this.error =
        "Greedy completion repeatedly failed before any complete solution was found"
      this.stats = {
        ...this.stats,
        greedyCompletionMissFailure: true,
        neverSuccessfullyRoutedRouteCount:
          this.getNeverSuccessfullyRoutedRoutes().length,
      }
      return true
    }

    if (this.shouldAcceptAfterGreedyCompletionStall()) {
      return this.acceptBestSolvedState("greedy_completion_stalled")
    }

    return false
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
          ...getTinyHyperGraphSolverOptions(this),
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
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost

      if (regionCost > currentRipThreshold) {
        regionIdsOverCostThreshold.push(regionId)
      }
    }

    const improvedBestSolvedState = this.captureBestSolvedState({
      maxRegionCost,
      totalRegionCost,
    })
    if (improvedBestSolvedState) {
      this.greedyCompletionStallCount = 0
    }

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

    if (this.ACCEPT_FIRST_COMPLETE_SOLUTION) {
      this.stats = {
        ...this.stats,
        acceptedFirstCompleteSolution: true,
      }
      this.solved = true
      return
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

    if (currentRouteId !== undefined) {
      this.routeOutOfCandidatesCountByRouteId[currentRouteId] += 1
    }

    if (this.tryEarlyGreedyCompletion("out_of_candidates")) {
      return
    }

    if (
      currentRouteId !== undefined &&
      this.bestSolvedStateSnapshot &&
      this.routeOutOfCandidatesCountByRouteId[currentRouteId]! >=
        this.MAX_REPEATED_ROUTE_FAILURES_AFTER_GREEDY_COMPLETION
    ) {
      this.stats = {
        ...this.stats,
        repeatedRouteFailureRouteId: currentRouteId,
        repeatedRouteFailureCount:
          this.routeOutOfCandidatesCountByRouteId[currentRouteId],
      }
      if (this.acceptBestSolvedState("repeated_route_failure")) {
        return
      }
    }

    if (
      currentRouteId !== undefined &&
      !this.bestSolvedStateSnapshot &&
      this.greedyCompletionSuccessCount === 0 &&
      this.routeOutOfCandidatesCountByRouteId[currentRouteId]! >=
        this.MAX_REPEATED_ROUTE_FAILURES_WITHOUT_GREEDY_COMPLETION
    ) {
      this.failed = true
      this.error = `Route ${currentRouteId} repeatedly exhausted candidates without any complete greedy fallback`
      this.stats = {
        ...this.stats,
        repeatedRouteFailureRouteId: currentRouteId,
        repeatedRouteFailureCount:
          this.routeOutOfCandidatesCountByRouteId[currentRouteId],
        repeatedRouteFailureWithoutGreedyCompletion: true,
        neverSuccessfullyRoutedRouteCount:
          this.getNeverSuccessfullyRoutedRoutes().length,
      }
      return
    }

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
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
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const { state } = this

    const nextRegionId = currentCandidate.nextRegionId

    const regionCache = state.regionIntersectionCaches[nextRegionId]
    const segmentGeometry = this.populateSegmentGeometryScratch(
      nextRegionId,
      currentCandidate.portId,
      neighborPortId,
    )

    const [
      newSameLayerIntersections,
      newCrossLayerIntersections,
      newEntryExitLayerChanges,
    ] = countNewIntersectionsWithValues(
      regionCache,
      state.currentRouteNetId!,
      segmentGeometry.lesserAngle,
      segmentGeometry.greaterAngle,
      segmentGeometry.layerMask,
      segmentGeometry.entryExitLayerChanges,
    )

    if (
      newSameLayerIntersections > 0 &&
      this.isKnownSingleLayerRegion(nextRegionId)
    ) {
      return Number.POSITIVE_INFINITY
    }

    const newRegionCost =
      this.computeRegionCostForRegion(
        nextRegionId,
        regionCache.existingSameLayerIntersections + newSameLayerIntersections,
        regionCache.existingCrossingLayerIntersections +
          newCrossLayerIntersections,
        regionCache.existingEntryExitLayerChanges + newEntryExitLayerChanges,
        regionCache.existingSegmentCount + 1,
      ) - regionCache.existingRegionCost

    return (
      currentCandidate.g +
      newRegionCost +
      state.regionCongestionCost[nextRegionId] +
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

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this)
  }

  override getOutput() {
    return convertToSerializedHyperGraph(this)
  }
}

class GreedyFinalRouteSolver extends TinyHyperGraphSolver {
  override computeG(
    currentCandidate: Candidate,
    _neighborPortId: PortId,
  ): number {
    return currentCandidate.g
  }
}
