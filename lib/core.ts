import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import {
  computeEstimatedViaCount,
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
const VIA_SEARCH_COST = 0.001
const MAX_CANDIDATE_QUALITIES_PER_HOP = 3

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
  solvedRouteStartPort: new Int32Array(snapshot.solvedRouteStartPort),
  solvedRouteEndPort: new Int32Array(snapshot.solvedRouteEndPort),
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

  /** Optional legal endpoint ports. The scalar arrays remain the legacy default. */
  routeStartPortOptions?: PortId[][]
  routeEndPortOptions?: PortId[][]

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

const getRoutePortOptions = (
  configuredOptions: PortId[][] | undefined,
  fallbackPorts: Int32Array,
  routeId: RouteId,
): PortId[] => {
  const options = configuredOptions?.[routeId]
  if (options && options.length > 0) {
    return [...new Set(options)]
  }

  return [fallbackPorts[routeId]!]
}

export const getRouteStartPortOptions = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
): PortId[] =>
  getRoutePortOptions(
    problem.routeStartPortOptions,
    problem.routeStartPort,
    routeId,
  )

export const getRouteEndPortOptions = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
): PortId[] =>
  getRoutePortOptions(
    problem.routeEndPortOptions,
    problem.routeEndPort,
    routeId,
  )

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
  /** Endpoint ports actually selected by each solved route. */
  solvedRouteStartPort?: Int32Array
  solvedRouteEndPort?: Int32Array
}

export interface RegionCostSummary {
  estimatedViaCount: number
  maxRegionCost: number
  totalRegionCost: number
}

export const compareRegionCostSummaries = (
  left: RegionCostSummary,
  right: RegionCostSummary,
): number => {
  const leftRiskDoesNotRegress =
    left.maxRegionCost <= right.maxRegionCost + Number.EPSILON &&
    left.totalRegionCost <= right.totalRegionCost + Number.EPSILON
  const rightRiskDoesNotRegress =
    right.maxRegionCost <= left.maxRegionCost + Number.EPSILON &&
    right.totalRegionCost <= left.totalRegionCost + Number.EPSILON

  if (
    left.estimatedViaCount < right.estimatedViaCount &&
    leftRiskDoesNotRegress
  ) {
    return -1
  }
  if (
    right.estimatedViaCount < left.estimatedViaCount &&
    rightRiskDoesNotRegress
  ) {
    return 1
  }
  if (left.maxRegionCost !== right.maxRegionCost) {
    return left.maxRegionCost - right.maxRegionCost
  }
  if (left.totalRegionCost !== right.totalRegionCost) {
    return left.totalRegionCost - right.totalRegionCost
  }
  return left.estimatedViaCount - right.estimatedViaCount
}

interface SolvedStateSnapshot {
  portAssignment: Int32Array
  solvedRouteStartPort: Int32Array
  solvedRouteEndPort: Int32Array
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

  estimatedViaCount?: number
  estimatedRemainingViaCount?: number
  regionRiskCost?: number
  routeLengthCost?: number
}

export interface CandidateQuality {
  estimatedViaCount: number
  regionRiskCost: number
  routeLengthCost: number
}

export interface TinyHyperGraphWorkingState {
  // portAssignment[portId] = NetId, -1 means unassigned
  portAssignment: Int32Array
  solvedRouteStartPort: Int32Array
  solvedRouteEndPort: Int32Array

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
  candidateParetoFrontierByHopId: Map<HopId, Candidate[]>

  goalPortId: PortId
  goalPortIds: Set<PortId>

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
})

export const getCandidateQuality = (
  candidate: Candidate,
): CandidateQuality => {
  if (
    candidate.estimatedViaCount !== undefined &&
    candidate.regionRiskCost !== undefined &&
    candidate.routeLengthCost !== undefined
  ) {
    return candidate as Candidate & CandidateQuality
  }

  return {
    estimatedViaCount: candidate.estimatedViaCount ?? 0,
    regionRiskCost: candidate.regionRiskCost ?? candidate.g,
    routeLengthCost: candidate.routeLengthCost ?? 0,
  }
}

export const compareCandidateQualities = (
  left: CandidateQuality,
  right: CandidateQuality,
): number =>
  left.estimatedViaCount - right.estimatedViaCount ||
  left.regionRiskCost - right.regionRiskCost ||
  left.routeLengthCost - right.routeLengthCost

const compareCandidateQualitiesByRisk = (
  left: CandidateQuality,
  right: CandidateQuality,
): number =>
  left.regionRiskCost - right.regionRiskCost ||
  left.estimatedViaCount - right.estimatedViaCount ||
  left.routeLengthCost - right.routeLengthCost

export const candidateQualityDominatesOrEquals = (
  left: CandidateQuality,
  right: CandidateQuality,
): boolean => {
  if (left.estimatedViaCount === right.estimatedViaCount) {
    return (
      left.regionRiskCost < right.regionRiskCost ||
      (left.regionRiskCost === right.regionRiskCost &&
        left.routeLengthCost <= right.routeLengthCost)
    )
  }

  return (
    left.estimatedViaCount <= right.estimatedViaCount &&
    left.regionRiskCost <= right.regionRiskCost &&
    left.routeLengthCost <= right.routeLengthCost
  )
}

const retainRepresentativeCandidates = (
  candidates: Candidate[],
): Candidate[] => {
  let byFewestVias = candidates[0]!
  let byLowestRisk = candidates[0]!
  let byBalancedSearchCost = candidates[0]!

  for (let index = 1; index < candidates.length; index++) {
    const candidate = candidates[index]!
    const quality = getCandidateQuality(candidate)
    const fewestViaQuality = getCandidateQuality(byFewestVias)
    const lowestRiskQuality = getCandidateQuality(byLowestRisk)
    const balancedQuality = getCandidateQuality(byBalancedSearchCost)

    if (compareCandidateQualities(quality, fewestViaQuality) < 0) {
      byFewestVias = candidate
    }
    if (compareCandidateQualitiesByRisk(quality, lowestRiskQuality) < 0) {
      byLowestRisk = candidate
    }

    const candidateBalancedCost =
      quality.regionRiskCost +
      quality.routeLengthCost +
      quality.estimatedViaCount * VIA_SEARCH_COST
    const retainedBalancedCost =
      balancedQuality.regionRiskCost +
      balancedQuality.routeLengthCost +
      balancedQuality.estimatedViaCount * VIA_SEARCH_COST
    if (
      candidateBalancedCost < retainedBalancedCost ||
      (candidateBalancedCost === retainedBalancedCost &&
        compareCandidateQualities(quality, balancedQuality) < 0)
    ) {
      byBalancedSearchCost = candidate
    }
  }

  const retained: Candidate[] = []
  for (const candidate of [
    byFewestVias,
    byLowestRisk,
    byBalancedSearchCost,
  ]) {
    if (!retained.includes(candidate)) retained.push(candidate)
  }
  return retained
}

export const compareCandidatesByQuality = (
  left: Candidate,
  right: Candidate,
): number =>
  (
    left.f - right.f ||
    (left.estimatedRemainingViaCount ?? 0) -
      (right.estimatedRemainingViaCount ?? 0)
  )

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
  protected bestSolvedStateSnapshot?: SolvedStateSnapshot
  protected bestSolvedStateSummary?: RegionCostSummary
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

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super()
    applyTinyHyperGraphSolverOptions(this, options)
    this.state = {
      portAssignment: new Int32Array(topology.portCount).fill(-1),
      solvedRouteStartPort: new Int32Array(problem.routeStartPort),
      solvedRouteEndPort: new Int32Array(problem.routeEndPort),
      regionSegments: Array.from({ length: topology.regionCount }, () => []),
      regionIntersectionCaches: Array.from(
        { length: topology.regionCount },
        () => createEmptyRegionIntersectionCache(),
      ),
      currentRouteId: undefined,
      currentRouteNetId: undefined,
      unroutedRoutes: range(problem.routeCount),
      candidateQueue: new MinHeap([], compareCandidatesByQuality),
      candidateBestCostByHopId: this.USE_SPARSE_CANDIDATE_STORAGE
        ? new Map()
        : new Float64Array(topology.portCount * topology.regionCount),
      candidateBestCostGenerationByHopId: this.USE_SPARSE_CANDIDATE_STORAGE
        ? new Map()
        : new Uint32Array(topology.portCount * topology.regionCount),
      candidateBestCostGeneration: 1,
      candidateParetoFrontierByHopId: new Map(),
      goalPortId: -1,
      goalPortIds: new Set(),
      ripCount: 0,
      regionCongestionCost: new Float64Array(topology.regionCount).fill(0),
    }
    this.routeAttemptCountByRouteId = new Uint32Array(problem.routeCount)
    this.routeSuccessCountByRouteId = new Uint32Array(problem.routeCount)
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
      const startPortIds = getRouteStartPortOptions(problem, routeId)
      const endPortIds = getRouteEndPortOptions(problem, routeId)
      for (const endpointPortId of [...startPortIds, ...endPortIds]) {
        portEndpointNetIds[endpointPortId]!.add(problem.routeNet[routeId])
      }

      if (portHCostToEndOfRoute) {
        for (let portId = 0; portId < topology.portCount; portId++) {
          let minDistance = Number.POSITIVE_INFINITY
          for (const endPortId of endPortIds) {
            const dx = portX[portId] - portX[endPortId]
            const dy = portY[portId] - portY[endPortId]
            minDistance = Math.min(minDistance, Math.hypot(dx, dy))
          }
          portHCostToEndOfRoute[portId * problem.routeCount + routeId] =
            minDistance * this.DISTANCE_TO_COST
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
      state.candidateQueue.clear()
      const startingPortIds = getRouteStartPortOptions(
        problem,
        state.currentRouteId!,
      )
      const goalPortIds = getRouteEndPortOptions(problem, state.currentRouteId!)
      state.goalPortIds = new Set(goalPortIds)
      state.goalPortId = goalPortIds[0]!

      let queuedStartingCandidateCount = 0
      for (const startingPortId of startingPortIds) {
        const startingNextRegionId = this.getStartingNextRegionId(
          state.currentRouteId!,
          startingPortId,
        )
        if (startingNextRegionId === undefined) continue

        const startingCandidate: Candidate = {
          nextRegionId: startingNextRegionId,
          portId: startingPortId,
          f: 0,
          g: 0,
          h: this.computeH(startingPortId),
          estimatedViaCount: 0,
          estimatedRemainingViaCount:
            this.computeEstimatedRemainingViaCount(startingPortId),
          regionRiskCost: 0,
          routeLengthCost: 0,
        }
        const startingHopId = this.getHopId(
          startingPortId,
          startingNextRegionId,
        )
        this.retainCandidateQuality(startingHopId, startingCandidate)
        if (
          this.queueCandidateIfSearchCostImproves(
            startingHopId,
            startingCandidate,
          )
        ) {
          queuedStartingCandidateCount += 1
        }
      }

      if (queuedStartingCandidateCount === 0) {
        this.failed = true
        this.error = `Route ${state.currentRouteId} has no start port with an incident region`
        return
      }
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
    if (
      getCandidateQuality(currentCandidate).regionRiskCost >
      this.getCandidateBestCost(currentCandidateHopId)
    ) {
      return
    }

    if (state.goalPortIds.has(currentCandidate.portId)) {
      state.goalPortId = currentCandidate.portId
      this.onPathFound(currentCandidate)
      return
    }

    if (this.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) {
      return
    }

    const neighbors =
      topology.regionIncidentPorts[currentCandidate.nextRegionId]
    let bestGoalCandidate: Candidate | undefined

    for (const neighborPortId of neighbors) {
      const assignedNetId = state.portAssignment[neighborPortId]
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
        continue
      }
      if (neighborPortId === currentCandidate.portId) continue
      const isGoalPort = state.goalPortIds.has(neighborPortId)
      if (!isGoalPort && problem.portSectionMask[neighborPortId] === 0) continue

      const quality = this.computeCandidateQuality(
        currentCandidate,
        neighborPortId,
      )
      if (!quality) continue
      const h = this.computeH(neighborPortId)

      const nextRegionId = isGoalPort
        ? currentCandidate.nextRegionId
        : topology.incidentPortRegion[neighborPortId][0] ===
            currentCandidate.nextRegionId
          ? topology.incidentPortRegion[neighborPortId][1]
          : topology.incidentPortRegion[neighborPortId][0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNet(nextRegionId)
      ) {
        continue
      }

      const newCandidate: Candidate = {
        prevRegionId: currentCandidate.nextRegionId,
        nextRegionId,
        portId: neighborPortId,
        g: quality.regionRiskCost,
        h,
        f: quality.regionRiskCost + h,
        estimatedRemainingViaCount:
          this.computeEstimatedRemainingViaCount(neighborPortId),
        ...quality,
        prevCandidate: currentCandidate,
      }

      if (isGoalPort) {
        if (
          !bestGoalCandidate ||
          compareCandidateQualities(
            getCandidateQuality(newCandidate),
            getCandidateQuality(bestGoalCandidate),
          ) < 0
        ) {
          bestGoalCandidate = newCandidate
        }
        continue
      }

      const candidateHopId = this.getHopId(neighborPortId, nextRegionId)
      this.retainCandidateQuality(candidateHopId, newCandidate)
      this.queueCandidateIfSearchCostImproves(candidateHopId, newCandidate)
    }

    if (bestGoalCandidate) {
      state.goalPortId = bestGoalCandidate.portId
      this.onPathFound(bestGoalCandidate)
    }
  }

  retainCandidateQuality(hopId: HopId, candidate: Candidate): boolean {
    const frontier = this.state.candidateParetoFrontierByHopId.get(hopId) ?? []
    const quality = getCandidateQuality(candidate)

    if (!this.shouldRetainParetoAlternatives()) {
      const existingCandidate = frontier[0]
      if (
        existingCandidate &&
        getCandidateQuality(existingCandidate).regionRiskCost <=
          quality.regionRiskCost
      ) {
        return false
      }
      this.state.candidateParetoFrontierByHopId.set(hopId, [candidate])
      return true
    }

    if (
      frontier.some((existingCandidate) =>
        candidateQualityDominatesOrEquals(
          getCandidateQuality(existingCandidate),
          quality,
        ),
      )
    ) {
      return false
    }

    let writeIndex = 0
    for (const existingCandidate of frontier) {
      if (
        candidateQualityDominatesOrEquals(
          quality,
          getCandidateQuality(existingCandidate),
        )
      ) {
        continue
      }
      frontier[writeIndex] = existingCandidate
      writeIndex += 1
    }
    frontier.length = writeIndex
    frontier.push(candidate)

    const retainedCandidates =
      frontier.length > MAX_CANDIDATE_QUALITIES_PER_HOP
        ? retainRepresentativeCandidates(frontier)
        : frontier
    this.state.candidateParetoFrontierByHopId.set(hopId, retainedCandidates)
    return retainedCandidates.includes(candidate)
  }

  protected shouldRetainParetoAlternatives(): boolean {
    return true
  }

  /**
   * The Pareto frontier records route quality, but the active A* queue keeps a
   * single strict risk label per hop. Mixing the two makes equal-risk
   * via/length improvements repeatedly re-expand the same graph state.
   */
  queueCandidateIfSearchCostImproves(
    hopId: HopId,
    candidate: Candidate,
  ): boolean {
    const searchCost = getCandidateQuality(candidate).regionRiskCost
    if (searchCost >= this.getCandidateBestCost(hopId)) return false

    this.setCandidateBestCost(hopId, searchCost)
    this.state.candidateQueue.queue(candidate)
    return true
  }

  resetCandidateBestCosts() {
    const { state } = this
    state.candidateParetoFrontierByHopId.clear()

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
    state.solvedRouteStartPort.set(problem.routeStartPort)
    state.solvedRouteEndPort.set(problem.routeEndPort)
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
    state.goalPortIds.clear()
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
    return compareRegionCostSummaries(left, right)
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
      solvedRouteStartPort: this.state.solvedRouteStartPort,
      solvedRouteEndPort: this.state.solvedRouteEndPort,
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
    this.state.solvedRouteStartPort = snapshot.solvedRouteStartPort
    this.state.solvedRouteEndPort = snapshot.solvedRouteEndPort
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
    this.state.goalPortIds.clear()
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
    solver.state.solvedRouteStartPort = clonedSnapshot.solvedRouteStartPort
    solver.state.solvedRouteEndPort = clonedSnapshot.solvedRouteEndPort
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
    solver.state.goalPortIds.clear()
  }

  protected summarizeSolvedState(
    solver: TinyHyperGraphSolver,
  ): RegionCostSummary {
    let estimatedViaCount = 0
    let maxRegionCost = 0
    let totalRegionCost = 0

    for (const regionIntersectionCache of solver.state
      .regionIntersectionCaches) {
      const regionCost = regionIntersectionCache.existingRegionCost
      estimatedViaCount += computeEstimatedViaCount(
        regionIntersectionCache.existingSameLayerIntersections,
        regionIntersectionCache.existingCrossingLayerIntersections,
        regionIntersectionCache.existingEntryExitLayerChanges,
      )
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost
    }

    return {
      estimatedViaCount,
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
      solvedRouteStartPort: this.state.solvedRouteStartPort,
      solvedRouteEndPort: this.state.solvedRouteEndPort,
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
        solvedRouteStartPort: greedySolver.state.solvedRouteStartPort,
        solvedRouteEndPort: greedySolver.state.solvedRouteEndPort,
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
        estimatedViaCount: this.bestSolvedStateSummary.estimatedViaCount,
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
    let estimatedViaCount = 0
    let maxRegionCost = 0
    let totalRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      const regionCache = state.regionIntersectionCaches[regionId]
      estimatedViaCount += computeEstimatedViaCount(
        regionCache?.existingSameLayerIntersections ?? 0,
        regionCache?.existingCrossingLayerIntersections ?? 0,
        regionCache?.existingEntryExitLayerChanges ?? 0,
      )
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost

      if (regionCost > currentRipThreshold) {
        regionIdsOverCostThreshold.push(regionId)
      }
    }

    this.captureBestSolvedState({
      estimatedViaCount,
      maxRegionCost,
      totalRegionCost,
    })

    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: regionIdsOverCostThreshold.length,
      estimatedViaCount,
      maxRegionCost,
      totalRegionCost,
      bestMaxRegionCost: this.bestSolvedStateSummary?.maxRegionCost,
      bestTotalRegionCost: this.bestSolvedStateSummary?.totalRegionCost,
      bestEstimatedViaCount:
        this.bestSolvedStateSummary?.estimatedViaCount,
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

    let firstCandidate = finalCandidate
    while (firstCandidate.prevCandidate) {
      firstCandidate = firstCandidate.prevCandidate
    }
    state.solvedRouteStartPort[currentRouteId] = firstCandidate.portId
    state.solvedRouteEndPort[currentRouteId] = finalCandidate.portId

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

    state.portAssignment[firstCandidate.portId] = state.currentRouteNetId!
    state.portAssignment[finalCandidate.portId] = state.currentRouteNetId!

    state.candidateQueue.clear()
    state.goalPortIds.clear()
    state.currentRouteNetId = undefined
    state.currentRouteId = undefined
  }

  protected computeCandidateRegionRiskCost(
    currentCandidate: Candidate,
    _neighborPortId: PortId,
    regionRiskIncrement: number,
    _routeLengthIncrement: number,
  ): number {
    return getCandidateQuality(currentCandidate).regionRiskCost + regionRiskIncrement
  }

  protected getSegmentRouteLengthCost(
    fromPortId: PortId,
    toPortId: PortId,
  ): number {
    const dx = this.topology.portX[fromPortId] - this.topology.portX[toPortId]
    const dy = this.topology.portY[fromPortId] - this.topology.portY[toPortId]
    return Math.sqrt(dx * dx + dy * dy) * this.DISTANCE_TO_COST
  }

  computeCandidateQuality(
    currentCandidate: Candidate,
    neighborPortId: PortId,
  ): CandidateQuality | undefined {
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
      return undefined
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

    const regionRiskIncrement =
      newRegionCost +
      state.regionCongestionCost[nextRegionId] +
      (this.problem.portPenalty?.[neighborPortId] ?? 0)
    const routeLengthIncrement = this.getSegmentRouteLengthCost(
      currentCandidate.portId,
      neighborPortId,
    )
    const currentQuality = getCandidateQuality(currentCandidate)
    const regionRiskCost = this.computeCandidateRegionRiskCost(
      currentCandidate,
      neighborPortId,
      regionRiskIncrement,
      routeLengthIncrement,
    )

    if (!Number.isFinite(regionRiskCost)) return undefined

    return {
      estimatedViaCount:
        currentQuality.estimatedViaCount +
        computeEstimatedViaCount(
          newSameLayerIntersections,
          newCrossLayerIntersections,
          newEntryExitLayerChanges,
        ),
      regionRiskCost,
      routeLengthCost:
        currentQuality.routeLengthCost + routeLengthIncrement,
    }
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    return (
      this.computeCandidateQuality(currentCandidate, neighborPortId)
        ?.regionRiskCost ?? Number.POSITIVE_INFINITY
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
        estimatedViaCount: this.bestSolvedStateSummary.estimatedViaCount,
        maxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
        totalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
        bestMaxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
        bestTotalRegionCost: this.bestSolvedStateSummary.totalRegionCost,
        bestEstimatedViaCount: this.bestSolvedStateSummary.estimatedViaCount,
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

    let minDistance = Number.POSITIVE_INFINITY
    for (const endPortId of getRouteEndPortOptions(
      this.problem,
      this.state.currentRouteId!,
    )) {
      const dx =
        this.topology.portX[neighborPortId] - this.topology.portX[endPortId]
      const dy =
        this.topology.portY[neighborPortId] - this.topology.portY[endPortId]
      minDistance = Math.min(minDistance, Math.hypot(dx, dy))
    }
    return minDistance * this.DISTANCE_TO_COST
  }

  computeEstimatedRemainingViaCount(portId: PortId): number {
    const currentZ = this.topology.portZ[portId]
    return getRouteEndPortOptions(
      this.problem,
      this.state.currentRouteId!,
    ).some((endPortId) => this.topology.portZ[endPortId] === currentZ)
      ? 0
      : 1
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this)
  }

  override getOutput() {
    return convertToSerializedHyperGraph(this)
  }
}

class GreedyFinalRouteSolver extends TinyHyperGraphSolver {
  protected override computeCandidateRegionRiskCost(
    currentCandidate: Candidate,
    _neighborPortId: PortId,
    _regionRiskIncrement: number,
    _routeLengthIncrement: number,
  ): number {
    return getCandidateQuality(currentCandidate).regionRiskCost
  }
}
