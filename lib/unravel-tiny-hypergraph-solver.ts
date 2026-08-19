import {
  type Candidate,
  createEmptyRegionIntersectionCache,
  getTinyHyperGraphSolverOptions,
  type RegionCostSummary,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "./core"
import { computeRoutingRiskRegionCostWithPreparedCapacity } from "./computeRegionCost"
import {
  classifyIntersectionLayerMasks,
  countNewIntersectionsWithValuesInto,
} from "./countNewIntersections"
import type {
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "./types"

const COST_EPSILON = 1e-9

const getPointToSegmentDistance = (
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number => {
  const dx = endX - startX
  const dy = endY - startY
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= COST_EPSILON) {
    return Math.hypot(pointX - startX, pointY - startY)
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared,
    ),
  )
  return Math.hypot(
    pointX - (startX + projection * dx),
    pointY - (startY + projection * dy),
  )
}

interface TerminalKeepout {
  minX: number
  minY: number
  maxX: number
  maxY: number
  z: number
  traceCenterClearance: number
  viaCenterClearance?: number
}

interface IndexedTerminalKeepout extends TerminalKeepout {
  netId: number
}

interface CachedTerminalKeepoutGeometry {
  violatingKeepoutIndexes: Int32Array
  violatingClearances: Float64Array
}

interface TerminalKeepoutNeighborPartition {
  neighborPortIds: readonly PortId[]
  constrainedNeighborIndexes: Int32Array
  constrainedGeometries: CachedTerminalKeepoutGeometry[]
}

const EMPTY_TERMINAL_KEEPOUT_GEOMETRY: CachedTerminalKeepoutGeometry = {
  violatingKeepoutIndexes: new Int32Array(),
  violatingClearances: new Float64Array(),
}

const EMPTY_TERMINAL_KEEPOUT_GEOMETRY_INDEX = -2

const getPointToBoundsDistance = (
  x: number,
  y: number,
  bounds: TerminalKeepout,
): number =>
  Math.hypot(
    Math.max(bounds.minX - x, 0, x - bounds.maxX),
    Math.max(bounds.minY - y, 0, y - bounds.maxY),
  )

const segmentIntersectsAxisAlignedBounds = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean => {
  let minimumT = 0
  let maximumT = 1
  for (const [start, delta, minimum, maximum] of [
    [startX, endX - startX, minX, maxX],
    [startY, endY - startY, minY, maxY],
  ] as const) {
    if (Math.abs(delta) <= COST_EPSILON) {
      if (start < minimum || start > maximum) return false
      continue
    }
    const firstT = (minimum - start) / delta
    const secondT = (maximum - start) / delta
    minimumT = Math.max(minimumT, Math.min(firstT, secondT))
    maximumT = Math.min(maximumT, Math.max(firstT, secondT))
    if (minimumT > maximumT) return false
  }
  return true
}

const segmentIntersectsBounds = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  bounds: TerminalKeepout,
): boolean =>
  segmentIntersectsAxisAlignedBounds(
    startX,
    startY,
    endX,
    endY,
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
  )

const boundsOverlap = (
  leftMinX: number,
  leftMinY: number,
  leftMaxX: number,
  leftMaxY: number,
  rightMinX: number,
  rightMinY: number,
  rightMaxX: number,
  rightMaxY: number,
) =>
  leftMinX <= rightMaxX + COST_EPSILON &&
  leftMaxX + COST_EPSILON >= rightMinX &&
  leftMinY <= rightMaxY + COST_EPSILON &&
  leftMaxY + COST_EPSILON >= rightMinY

const getSegmentToBoundsDistance = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  bounds: TerminalKeepout,
): number => {
  if (segmentIntersectsBounds(startX, startY, endX, endY, bounds)) return 0
  return Math.min(
    getPointToBoundsDistance(startX, startY, bounds),
    getPointToBoundsDistance(endX, endY, bounds),
    ...[
      [bounds.minX, bounds.minY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
    ].map(([x, y]) =>
      getPointToSegmentDistance(x!, y!, startX, startY, endX, endY),
    ),
  )
}

const getSegmentToTerminalKeepoutClearance = ({
  startX,
  startY,
  startZ,
  endX,
  endY,
  endZ,
  keepout,
}: {
  startX: number
  startY: number
  startZ: number
  endX: number
  endY: number
  endZ: number
  keepout: TerminalKeepout
}): number => {
  const isLayerChange = startZ !== endZ
  if (
    (!isLayerChange && keepout.z !== startZ) ||
    (isLayerChange &&
      (keepout.z < Math.min(startZ, endZ) ||
        keepout.z > Math.max(startZ, endZ)))
  ) {
    return Number.POSITIVE_INFINITY
  }
  return (
    getSegmentToBoundsDistance(startX, startY, endX, endY, keepout) -
    (isLayerChange
      ? (keepout.viaCenterClearance ?? keepout.traceCenterClearance)
      : keepout.traceCenterClearance)
  )
}

interface BoundaryPortSlot {
  portId: PortId
  routeId?: RouteId
  region1Id: RegionId
  region2Id: RegionId
  region1OtherPortId?: PortId
  region2OtherPortId?: PortId
}

interface BoundaryPortGroup {
  slots: BoundaryPortSlot[]
  fixedAnchorPortIds: PortId[]
}

interface PortOccurrence {
  regionId: RegionId
  routeId: RouteId
  otherPortId: PortId
}

interface UnravelRegionCostSummary extends RegionCostSummary {
  maxRegionSegmentCount: number
  squaredRegionSegmentCount: number
  /** Total planar length of all region-local route chords. */
  totalSegmentLength: number
  /** Downstream high-density crossing-risk metrics for composite cost plateaus. */
  maxRoutingRisk: number
  squaredRoutingRisk: number
  totalRoutingRisk: number
  /** Worst risk when every routed segment is retained as a physical chord. */
  maxSegmentRoutingRisk: number
  squaredSegmentRoutingRisk: number
  totalSegmentRoutingRisk: number
  /** Exact via-demand risk used by the downstream high-density router. */
  maxDownstreamRisk: number
  squaredDownstreamRisk: number
  totalDownstreamRisk: number
}

interface BoundaryPermutation {
  slots: BoundaryPortSlot[]
  destinationPortIds: PortId[]
}

interface BoundaryMutation {
  kind: "swap" | "cycle"
  permutation: BoundaryPermutation
  region1Id: RegionId
  region2Id: RegionId
  region1Cost: number
  region2Cost: number
  region1RoutingRisk: number
  region2RoutingRisk: number
  region1SegmentRoutingRisk: number
  region2SegmentRoutingRisk: number
  region1DownstreamRisk: number
  region2DownstreamRisk: number
  region1SegmentLength: number
  region2SegmentLength: number
  fixedAnchorPortIds: PortId[]
  summary: UnravelRegionCostSummary
}

interface BoundaryScoringContext {
  squaredRoutingRiskByRegion: Float64Array
  squaredSegmentRoutingRiskByRegion: Float64Array
  squaredDownstreamRiskByRegion: Float64Array
  getUnaffectedMaxRegionCost: (
    region1Id: RegionId,
    region2Id: RegionId,
  ) => number
  getUnaffectedMaxRoutingRisk: (
    region1Id: RegionId,
    region2Id: RegionId,
  ) => number
  getUnaffectedMaxSegmentRoutingRisk: (
    region1Id: RegionId,
    region2Id: RegionId,
  ) => number
  getUnaffectedMaxDownstreamRisk: (
    region1Id: RegionId,
    region2Id: RegionId,
  ) => number
}

type BoundaryMutationScore = Omit<BoundaryMutation, "kind" | "permutation">

interface RerouteMutation {
  kind: "reroute"
  routeId: RouteId
  routeIds: RouteId[]
  congestionFactor: number
  replacementPath: ReplacementPathSegment[]
  replacementState: {
    portAssignment: Int32Array
    regionSegments: Array<[RouteId, PortId, PortId][]>
    regionIntersectionCaches: RegionIntersectionCache[]
  }
  replacementRouteMetrics: Array<{
    routeId: RouteId
    layerChangeCount: number
    segmentLength: number
    foreignEndpointClearances: Float64Array
  }>
  routingRiskByRegion: Float64Array
  segmentRoutingRiskByRegion: Float64Array
  downstreamRiskByRegion: Float64Array
  segmentLengthByRegion: Float64Array
  summary: UnravelRegionCostSummary
}

interface ScoredSolverState {
  summary: UnravelRegionCostSummary
  routingRiskByRegion: Float64Array
  segmentRoutingRiskByRegion: Float64Array
  downstreamRiskByRegion: Float64Array
  segmentLengthByRegion: Float64Array
}

interface ReplacementPathSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

interface CachedReroutePath {
  routeId: RouteId
  congestionFactor: number
  replacementPath: ReplacementPathSegment[]
}

interface AcceptedRerouteMutation {
  routeIds: RouteId[]
  previousPaths: Array<{
    routeId: RouteId
    path: ReplacementPathSegment[]
  }>
  reverted: boolean
}

export interface UnravelTinyHyperGraphSolverOptions
  extends TinyHyperGraphSolverOptions {
  /** Route ids whose solved segments and boundary-port assignments are fixed. */
  FIXED_ROUTE_IDS?: readonly RouteId[]
  /** Optional hard cap across all accepted mutations. */
  MAX_MUTATIONS?: number
  /** Maximum whole-route replacements after the initial untwist descent. */
  MAX_REROUTE_MUTATIONS?: number
  /** Number of the most expensive regions whose routes are considered. */
  MAX_HOT_REGIONS?: number
  /** Optional iteration cap for each route-replacement search. */
  REROUTE_MAX_ITERATIONS?: number
  /** Maximum routes from the hot regions evaluated per mutation. */
  MAX_REROUTE_ROUTES?: number
  /** Congestion multipliers explored for each route replacement. */
  REROUTE_CONGESTION_FACTORS?: number[]
  /** Optional maximum extra region segments for an individual rerouted route. */
  MAX_REROUTE_SEGMENT_INCREASE?: number
}

const cloneRegionIntersectionCache = (
  cache: RegionIntersectionCache,
): RegionIntersectionCache => ({
  netIds: new Int32Array(cache.netIds),
  lesserAngles: new Int32Array(cache.lesserAngles),
  greaterAngles: new Int32Array(cache.greaterAngles),
  layerMasks: new Int32Array(cache.layerMasks),
  existingCrossingLayerIntersections: cache.existingCrossingLayerIntersections,
  existingSameLayerIntersections: cache.existingSameLayerIntersections,
  existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
  existingRegionCost: cache.existingRegionCost,
  existingSegmentCount: cache.existingSegmentCount,
})

const compareRegionCostSummaries = (
  left: UnravelRegionCostSummary,
  right: UnravelRegionCostSummary,
) => {
  if (Math.abs(left.maxRegionCost - right.maxRegionCost) > COST_EPSILON) {
    return left.maxRegionCost - right.maxRegionCost
  }

  if (left.maxRegionSegmentCount !== right.maxRegionSegmentCount) {
    return left.maxRegionSegmentCount - right.maxRegionSegmentCount
  }

  if (left.squaredRegionSegmentCount !== right.squaredRegionSegmentCount) {
    return left.squaredRegionSegmentCount - right.squaredRegionSegmentCount
  }

  if (Math.abs(left.totalRegionCost - right.totalRegionCost) > COST_EPSILON) {
    return left.totalRegionCost - right.totalRegionCost
  }

  if (Math.abs(left.maxRoutingRisk - right.maxRoutingRisk) > COST_EPSILON) {
    return left.maxRoutingRisk - right.maxRoutingRisk
  }

  if (
    Math.abs(left.squaredRoutingRisk - right.squaredRoutingRisk) > COST_EPSILON
  ) {
    return left.squaredRoutingRisk - right.squaredRoutingRisk
  }

  if (Math.abs(left.totalRoutingRisk - right.totalRoutingRisk) > COST_EPSILON) {
    return left.totalRoutingRisk - right.totalRoutingRisk
  }

  if (
    Math.abs(left.maxSegmentRoutingRisk - right.maxSegmentRoutingRisk) >
    COST_EPSILON
  ) {
    return left.maxSegmentRoutingRisk - right.maxSegmentRoutingRisk
  }

  if (
    Math.abs(left.maxDownstreamRisk - right.maxDownstreamRisk) > COST_EPSILON
  ) {
    return left.maxDownstreamRisk - right.maxDownstreamRisk
  }

  if (
    Math.abs(left.squaredDownstreamRisk - right.squaredDownstreamRisk) >
    COST_EPSILON
  ) {
    return left.squaredDownstreamRisk - right.squaredDownstreamRisk
  }

  if (
    Math.abs(left.totalDownstreamRisk - right.totalDownstreamRisk) >
    COST_EPSILON
  ) {
    return left.totalDownstreamRisk - right.totalDownstreamRisk
  }

  if (
    Math.abs(left.totalSegmentLength - right.totalSegmentLength) > COST_EPSILON
  ) {
    return left.totalSegmentLength - right.totalSegmentLength
  }

  return 0
}

const isParetoImprovement = (
  candidate: UnravelRegionCostSummary,
  current: UnravelRegionCostSummary,
) => {
  if (!isRoutingRiskNoWorse(candidate, current, current)) return false

  if (candidate.maxRegionCost < current.maxRegionCost - COST_EPSILON) {
    return true
  }
  if (candidate.maxRegionCost > current.maxRegionCost + COST_EPSILON) {
    return false
  }

  const noWorse =
    candidate.totalRegionCost <= current.totalRegionCost + COST_EPSILON &&
    candidate.maxRegionSegmentCount <= current.maxRegionSegmentCount &&
    candidate.squaredRegionSegmentCount <= current.squaredRegionSegmentCount &&
    candidate.totalSegmentLength <= current.totalSegmentLength + COST_EPSILON
  if (!noWorse) return false

  return (
    candidate.totalRegionCost < current.totalRegionCost - COST_EPSILON ||
    candidate.maxRegionSegmentCount < current.maxRegionSegmentCount ||
    candidate.squaredRegionSegmentCount < current.squaredRegionSegmentCount ||
    candidate.maxRoutingRisk < current.maxRoutingRisk - COST_EPSILON ||
    candidate.squaredRoutingRisk < current.squaredRoutingRisk - COST_EPSILON ||
    candidate.totalRoutingRisk < current.totalRoutingRisk - COST_EPSILON ||
    candidate.squaredSegmentRoutingRisk <
      current.squaredSegmentRoutingRisk - COST_EPSILON ||
    candidate.totalSegmentRoutingRisk <
      current.totalSegmentRoutingRisk - COST_EPSILON ||
    candidate.maxDownstreamRisk < current.maxDownstreamRisk - COST_EPSILON ||
    candidate.squaredDownstreamRisk <
      current.squaredDownstreamRisk - COST_EPSILON ||
    candidate.totalDownstreamRisk < current.totalDownstreamRisk - COST_EPSILON
  )
}

const isRoutingRiskNoWorse = (
  candidate: UnravelRegionCostSummary,
  current: UnravelRegionCostSummary,
  downstreamBaseline: UnravelRegionCostSummary = current,
) =>
  candidate.maxRoutingRisk <= current.maxRoutingRisk + COST_EPSILON &&
  candidate.squaredRoutingRisk <= current.squaredRoutingRisk + COST_EPSILON &&
  candidate.totalRoutingRisk <= current.totalRoutingRisk + COST_EPSILON &&
  candidate.maxSegmentRoutingRisk <=
    current.maxSegmentRoutingRisk + COST_EPSILON &&
  candidate.maxDownstreamRisk <=
    downstreamBaseline.maxDownstreamRisk + COST_EPSILON &&
  candidate.squaredDownstreamRisk <=
    downstreamBaseline.squaredDownstreamRisk + COST_EPSILON &&
  candidate.totalDownstreamRisk <=
    downstreamBaseline.totalDownstreamRisk + COST_EPSILON

/**
 * Boundary swaps preserve the set of routes in each region and each route's
 * transition count. Capacity-aware maxima may never regress from the current
 * state. Exact downstream via-demand may redistribute between regions, but
 * its aggregate pressure metrics must improve monotonically so a later
 * region-cost win cannot trade away an easier detailed-routing state. A
 * strict peak reduction may spend wirelength to remove the bottleneck;
 * peak-preserving cleanup must not make the detailed-routing geometry longer.
 */
const isSwapParetoImprovement = (
  candidate: UnravelRegionCostSummary,
  current: UnravelRegionCostSummary,
) =>
  compareRegionCostSummaries(candidate, current) < 0 &&
  candidate.maxRoutingRisk <= current.maxRoutingRisk + COST_EPSILON &&
  candidate.maxSegmentRoutingRisk <=
    current.maxSegmentRoutingRisk + COST_EPSILON &&
  candidate.maxDownstreamRisk <= current.maxDownstreamRisk + COST_EPSILON &&
  candidate.squaredDownstreamRisk <=
    current.squaredDownstreamRisk + COST_EPSILON &&
  candidate.totalDownstreamRisk <= current.totalDownstreamRisk + COST_EPSILON

/**
 * Whole-route replacement changes the topology consumed by detailed routing,
 * so it must advance the primary region-cost objective. Secondary-only
 * untwists remain available through boundary permutations, which preserve the
 * route topology.
 */
const isRerouteParetoImprovement = (
  candidate: UnravelRegionCostSummary,
  current: UnravelRegionCostSummary,
) =>
  isParetoImprovement(candidate, current) &&
  (candidate.maxRegionCost < current.maxRegionCost - COST_EPSILON ||
    candidate.totalRegionCost < current.totalRegionCost - COST_EPSILON)

const createWholeGraphProblem = (
  problem: TinyHyperGraphProblem,
  portCount: number,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask: new Int8Array(portCount).fill(1),
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeNet: problem.routeNet,
  regionNetId: problem.regionNetId,
  portPenalty: problem.portPenalty,
})

const getUnravelCoreOptions = (
  inputSolver: TinyHyperGraphSolver,
  options?: UnravelTinyHyperGraphSolverOptions,
): TinyHyperGraphSolverOptions => ({
  ...getTinyHyperGraphSolverOptions(inputSolver),
  STATIC_REACHABILITY_PRECHECK: false,
  ...options,
})

interface ReplacementRegionChordScorer {
  sourceCache: RegionIntersectionCache
  regionPortCount: number
  intersectionCountStride: number
  absentOwnerId: number
  ownerSegmentIndexesByOwnerId: Map<number, Int32Array>
  /**
   * Symmetric region-local chord tables, allocated one row at a time. A zero
   * packed value means "not scored"; real intersection counts are stored +1.
   */
  packedIntersectionCountsByLocalPort: Array<Float64Array | undefined>
  /** Final costs for owners that have no fixed chord in this region. */
  sharedFinalCostsByLocalPort: Array<Float64Array | undefined>
}

interface ActiveReplacementRegionCostMemo {
  sourceCache: RegionIntersectionCache
  ownerId: number
  scorer: ReplacementRegionChordScorer
  ownerSegmentIndexes?: Int32Array
  /** Final costs that include the active owner's exact crossing correction. */
  finalCostsByLocalPort?: Array<Float64Array | undefined>
}

class SingleRouteReplacementSolver extends TinyHyperGraphSolver {
  replacementRouteSegmentCount = 0
  physicalNeighborCacheHitCount = 0
  physicalNeighborCacheMissCount = 0
  readonly replacementRouteSegmentCountByRouteId: Int32Array
  readonly replacementRouteLayerChangeCountByRouteId: Int32Array
  readonly replacementRouteSegmentLengthByRouteId: Float64Array
  readonly blockingRouteIds = new Set<RouteId>()
  private readonly writableRegionMask: Int8Array
  private readonly writableRegionIds: RegionId[] = []
  private readonly replacementPathByRouteId = new Map<
    RouteId,
    ReplacementPathSegment[]
  >()
  private readonly physicalNeighborsByRouteId: Array<
    Map<number, readonly PortId[]>
  >
  private readonly replacementRegionChordScorerByCache = new WeakMap<
    RegionIntersectionCache,
    ReplacementRegionChordScorer
  >()
  private readonly activeReplacementRegionCostMemoByRegion: Array<
    ActiveReplacementRegionCostMemo | undefined
  >
  private readonly firstRegionLocalPortIndexByPortId: Int32Array
  private readonly secondRegionLocalPortIndexByPortId: Int32Array
  private readonly overflowRegionLocalPortIndex = new Map<number, number>()
  private readonly replacementIntersectionCountsScratch = new Int32Array(3)
  replacementRegionCostCacheHitCount = 0
  replacementRegionCostCacheMissCount = 0
  private indexedInputRegionSegments?: Array<[RouteId, PortId, PortId][]>
  private readonly inputRegionIdsByRouteId: RegionId[][]

  constructor(
    inputSolver: TinyHyperGraphSolver,
    maxIterations: number,
    private readonly isReplacementSegmentAllowed?: (
      routeId: RouteId,
      regionId: RegionId,
      fromPortId: PortId,
      toPortId: PortId,
    ) => boolean,
    private readonly getReplacementNeighborPortIds?: (
      routeId: RouteId,
      regionId: RegionId,
      fromPortId: PortId,
      neighborPortIds: readonly PortId[],
    ) => readonly PortId[],
  ) {
    super(
      inputSolver.topology,
      createWholeGraphProblem(
        inputSolver.problem,
        inputSolver.topology.portCount,
      ),
      {
        ...getTinyHyperGraphSolverOptions(inputSolver),
        // Search the same cost model that the caller selected. Physical-risk
        // and endpoint-clearance invariants are scored independently on the
        // completed state; replacing the caller's objective here can hide the
        // best valid path from A*.
        TRACE_DENSITY_COST_FACTOR: inputSolver.TRACE_DENSITY_COST_FACTOR,
        STATIC_REACHABILITY_PRECHECK: false,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        USE_LAZY_ROUTE_HEURISTIC: true,
        MAX_ITERATIONS: maxIterations,
      },
    )
    this.writableRegionMask = new Int8Array(this.topology.regionCount)
    this.replacementRouteSegmentCountByRouteId = new Int32Array(
      this.problem.routeCount,
    )
    this.replacementRouteLayerChangeCountByRouteId = new Int32Array(
      this.problem.routeCount,
    )
    this.replacementRouteSegmentLengthByRouteId = new Float64Array(
      this.problem.routeCount,
    )
    this.inputRegionIdsByRouteId = Array.from(
      { length: this.problem.routeCount },
      () => [],
    )
    this.physicalNeighborsByRouteId = Array.from(
      { length: this.problem.routeCount },
      () => new Map(),
    )
    this.activeReplacementRegionCostMemoByRegion = new Array(
      this.topology.regionCount,
    )
    this.firstRegionLocalPortIndexByPortId = new Int32Array(
      this.topology.portCount,
    ).fill(-1)
    this.secondRegionLocalPortIndexByPortId = new Int32Array(
      this.topology.portCount,
    ).fill(-1)
    for (
      let regionId = 0;
      regionId < this.topology.regionIncidentPorts.length;
      regionId++
    ) {
      const incidentPortIds = this.topology.regionIncidentPorts[regionId]!
      for (
        let localIndex = 0;
        localIndex < incidentPortIds.length;
        localIndex++
      ) {
        const portId = incidentPortIds[localIndex]!
        if (this.candidateFirstRegionByPortId[portId] === regionId) {
          this.firstRegionLocalPortIndexByPortId[portId] = localIndex
        } else if (this.candidateSecondRegionByPortId[portId] === regionId) {
          this.secondRegionLocalPortIndexByPortId[portId] = localIndex
        } else {
          this.overflowRegionLocalPortIndex.set(
            portId * this.topology.regionCount + regionId,
            localIndex,
          )
        }
      }
    }
  }

  private indexInputRouteRegions(inputSolver: TinyHyperGraphSolver) {
    if (this.indexedInputRegionSegments === inputSolver.state.regionSegments) {
      return
    }
    for (const regionIds of this.inputRegionIdsByRouteId) regionIds.length = 0
    for (
      let regionId = 0;
      regionId < inputSolver.state.regionSegments.length;
      regionId++
    ) {
      for (const [routeId] of inputSolver.state.regionSegments[regionId]!) {
        const regionIds = this.inputRegionIdsByRouteId[routeId]!
        if (regionIds[regionIds.length - 1] !== regionId) {
          regionIds.push(regionId)
        }
      }
    }
    this.indexedInputRegionSegments = inputSolver.state.regionSegments
  }

  resetForRoute(
    inputSolver: TinyHyperGraphSolver,
    routeIdToReplace: RouteId,
    congestionFactor: number,
  ) {
    this.resetForRoutes(inputSolver, [routeIdToReplace], congestionFactor)
  }

  resetForRoutes(
    inputSolver: TinyHyperGraphSolver,
    routeIdsToReplace: RouteId[],
    congestionFactor: number,
  ) {
    const routeIdSet = new Set(routeIdsToReplace)
    this.indexInputRouteRegions(inputSolver)
    this.TRACE_DENSITY_COST_FACTOR = inputSolver.TRACE_DENSITY_COST_FACTOR
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.progress = 0
    this.activeSubSolver = null
    this.failedSubSolvers = []
    this.timeToSolve = undefined
    this.stats = {}
    this._setupDone = false
    this.bestSolvedStateSnapshot = undefined
    this.bestSolvedStateSummary = undefined
    this.routeAttemptCountByRouteId.fill(0)
    this.routeSuccessCountByRouteId.fill(0)
    this.replacementRouteSegmentCount = 0
    this.replacementRouteSegmentCountByRouteId.fill(0)
    this.replacementRouteLayerChangeCountByRouteId.fill(0)
    this.replacementRouteSegmentLengthByRouteId.fill(0)
    this.replacementPathByRouteId.clear()
    this.writableRegionMask.fill(0)
    this.writableRegionIds.length = 0
    this.blockingRouteIds.clear()
    this.state.portAssignment.set(inputSolver.state.portAssignment)
    this.state.regionSegments = inputSolver.state.regionSegments.slice()
    this.state.regionIntersectionCaches =
      inputSolver.state.regionIntersectionCaches.slice()
    const removedPortIds = new Set<PortId>()
    const affectedRegionIds = [
      ...new Set(
        routeIdsToReplace.flatMap(
          (routeId) => this.inputRegionIdsByRouteId[routeId]!,
        ),
      ),
    ].sort((left, right) => left - right)

    for (const regionId of affectedRegionIds) {
      const inputSegments = inputSolver.state.regionSegments[regionId]!
      this.writableRegionMask[regionId] = 1
      this.writableRegionIds.push(regionId)
      this.state.regionSegments[regionId] = inputSegments.filter(
        ([routeId, fromPortId, toPortId]) => {
          if (!routeIdSet.has(routeId)) return true
          removedPortIds.add(fromPortId)
          removedPortIds.add(toPortId)
          return false
        },
      )
      this.rebuildRegionCache(regionId)
    }

    for (const portId of removedPortIds) {
      this.state.portAssignment[portId] = -1
      for (const regionId of this.topology.incidentPortRegion[portId] ?? []) {
        const retainingSegment = this.state.regionSegments[regionId]!.find(
          ([, fromPortId, toPortId]) =>
            fromPortId === portId || toPortId === portId,
        )
        if (retainingSegment) {
          this.state.portAssignment[portId] =
            this.problem.routeNet[retainingSegment[0]]!
          break
        }
      }
    }

    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = [...routeIdsToReplace]
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    if (congestionFactor === 0) {
      this.state.regionCongestionCost.fill(0)
    } else {
      for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
        this.state.regionCongestionCost[regionId] =
          inputSolver.state.regionIntersectionCaches[regionId]!
            .existingRegionCost * congestionFactor
      }
    }
  }

  override onAllRoutesRouted() {
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.solved = true
  }

  override isPortReservedForDifferentNet(portId: PortId): boolean {
    const blocked = super.isPortReservedForDifferentNet(portId)
    if (!blocked) return false
    for (const regionId of this.topology.incidentPortRegion[portId] ?? []) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        if (
          routeId !== this.state.currentRouteId &&
          (fromPortId === portId || toPortId === portId)
        ) {
          this.blockingRouteIds.add(routeId)
        }
      }
    }
    return true
  }

  protected override getCandidateNeighborPortIds(
    currentCandidate: Candidate,
  ): readonly PortId[] {
    const routeId = this.state.currentRouteId
    if (
      routeId === undefined ||
      (!this.isReplacementSegmentAllowed && !this.getReplacementNeighborPortIds)
    ) {
      return super.getCandidateNeighborPortIds(currentCandidate)
    }
    const hopId = this.getHopId(
      currentCandidate.portId,
      currentCandidate.nextRegionId,
    )
    const routeCache = this.physicalNeighborsByRouteId[routeId]!
    const cached = routeCache.get(hopId)
    if (cached) {
      this.physicalNeighborCacheHitCount += 1
      return cached
    }
    this.physicalNeighborCacheMissCount += 1

    const candidateNeighborPortIds = super.getCandidateNeighborPortIds(
      currentCandidate,
    )
    const neighbors = this.getReplacementNeighborPortIds
      ? this.getReplacementNeighborPortIds(
          routeId,
          currentCandidate.nextRegionId,
          currentCandidate.portId,
          candidateNeighborPortIds,
        )
      : candidateNeighborPortIds.filter(
          (neighborPortId) =>
            neighborPortId === currentCandidate.portId ||
            this.isReplacementSegmentAllowed!(
              routeId,
              currentCandidate.nextRegionId,
              currentCandidate.portId,
              neighborPortId,
            ),
        )
    routeCache.set(hopId, neighbors)
    return neighbors
  }

  invalidatePhysicalNeighborCache(routeIds: readonly RouteId[]) {
    for (const routeId of routeIds) {
      this.physicalNeighborsByRouteId[routeId]?.clear()
    }
  }

  override onPathFound(
    finalCandidate: Parameters<TinyHyperGraphSolver["onPathFound"]>[0],
  ) {
    const solvedSegments = this.getSolvedPathSegments(finalCandidate)
    if (
      this.state.currentRouteId !== undefined &&
      this.isReplacementSegmentAllowed &&
      solvedSegments.some(
        ({ regionId, fromPortId, toPortId }) =>
          !this.isReplacementSegmentAllowed!(
            this.state.currentRouteId!,
            regionId,
            fromPortId,
            toPortId,
          ),
      )
    ) {
      return
    }
    this.replacementRouteSegmentCount = solvedSegments.length
    this.replacementRouteSegmentCountByRouteId[this.state.currentRouteId!] =
      solvedSegments.length
    let replacementRouteLayerChangeCount = 0
    let replacementRouteSegmentLength = 0
    for (const { fromPortId, toPortId } of solvedSegments) {
      if (this.topology.portZ[fromPortId] !== this.topology.portZ[toPortId]) {
        replacementRouteLayerChangeCount += 1
      }
      replacementRouteSegmentLength += Math.hypot(
        this.topology.portX[toPortId]! - this.topology.portX[fromPortId]!,
        this.topology.portY[toPortId]! - this.topology.portY[fromPortId]!,
      )
    }
    this.replacementRouteLayerChangeCountByRouteId[this.state.currentRouteId!] =
      replacementRouteLayerChangeCount
    this.replacementRouteSegmentLengthByRouteId[this.state.currentRouteId!] =
      replacementRouteSegmentLength
    this.replacementPathByRouteId.set(
      this.state.currentRouteId!,
      solvedSegments.map(({ regionId, fromPortId, toPortId }) => ({
        regionId,
        fromPortId,
        toPortId,
      })),
    )
    const touchedRegionIds = new Set<RegionId>()
    for (const { regionId } of solvedSegments) {
      touchedRegionIds.add(regionId)
      if (this.writableRegionMask[regionId] === 0) {
        this.state.regionSegments[regionId] = [
          ...this.state.regionSegments[regionId]!,
        ]
        this.writableRegionMask[regionId] = 1
        this.writableRegionIds.push(regionId)
      }
    }
    super.onPathFound(finalCandidate)

    // Serialized solutions are replayed in route-id order. Keep the same
    // canonical order here because angular interval accumulation is not
    // commutative for wraparound segments, and rebuild only the regions that
    // the replacement route actually touched.
    for (const regionId of touchedRegionIds) {
      this.state.regionSegments[regionId]!.sort(
        (left, right) => left[0] - right[0],
      )
      this.rebuildRegionCache(regionId)
    }
  }

  private getRegionLocalPortIndex(regionId: RegionId, portId: PortId): number {
    if (this.candidateFirstRegionByPortId[portId] === regionId) {
      return this.firstRegionLocalPortIndexByPortId[portId]!
    }
    if (this.candidateSecondRegionByPortId[portId] === regionId) {
      return this.secondRegionLocalPortIndexByPortId[portId]!
    }
    return (
      this.overflowRegionLocalPortIndex.get(
        portId * this.topology.regionCount + regionId,
      ) ?? -1
    )
  }

  private createReplacementRegionChordScorer(
    regionId: RegionId,
    sourceCache: RegionIntersectionCache,
  ): ReplacementRegionChordScorer {
    const ownerSegmentIndexes = new Map<number, number[]>()
    for (let index = 0; index < sourceCache.netIds.length; index++) {
      const ownerId = sourceCache.netIds[index]!
      const indexes = ownerSegmentIndexes.get(ownerId)
      if (indexes) indexes.push(index)
      else ownerSegmentIndexes.set(ownerId, [index])
    }
    const ownerSegmentIndexesByOwnerId = new Map<number, Int32Array>()
    for (const [ownerId, indexes] of ownerSegmentIndexes) {
      ownerSegmentIndexesByOwnerId.set(ownerId, Int32Array.from(indexes))
    }
    let absentOwnerId = -1
    while (ownerSegmentIndexesByOwnerId.has(absentOwnerId)) absentOwnerId -= 1
    const regionPortCount = this.topology.regionIncidentPorts[regionId]!.length
    return {
      sourceCache,
      regionPortCount,
      intersectionCountStride: sourceCache.netIds.length + 1,
      absentOwnerId,
      ownerSegmentIndexesByOwnerId,
      packedIntersectionCountsByLocalPort: new Array(regionPortCount),
      sharedFinalCostsByLocalPort: new Array(regionPortCount),
    }
  }

  private getActiveReplacementRegionCostMemo(
    regionId: RegionId,
  ): ActiveReplacementRegionCostMemo {
    const sourceCache = this.state.regionIntersectionCaches[regionId]!
    const ownerId = this.getCurrentIntersectionOwnerId()
    const activeMemo = this.activeReplacementRegionCostMemoByRegion[regionId]
    if (
      activeMemo?.sourceCache === sourceCache &&
      activeMemo.ownerId === ownerId
    ) {
      return activeMemo
    }

    let scorer = this.replacementRegionChordScorerByCache.get(sourceCache)
    if (!scorer) {
      scorer = this.createReplacementRegionChordScorer(regionId, sourceCache)
      this.replacementRegionChordScorerByCache.set(sourceCache, scorer)
    }
    const ownerSegmentIndexes = scorer.ownerSegmentIndexesByOwnerId.get(ownerId)
    const nextMemo: ActiveReplacementRegionCostMemo = {
      sourceCache,
      ownerId,
      scorer,
      ownerSegmentIndexes,
      finalCostsByLocalPort: ownerSegmentIndexes
        ? new Array(scorer.regionPortCount)
        : undefined,
    }
    this.activeReplacementRegionCostMemoByRegion[regionId] = nextMemo
    return nextMemo
  }

  private countOwnerChordIntersections(
    cache: RegionIntersectionCache,
    ownerSegmentIndexes: Int32Array,
    newLesserAngle: number,
    newGreaterAngle: number,
    newLayerMask: number,
  ): [sameLayer: number, crossingLayer: number] {
    let sameLayerIntersections = 0
    let crossingLayerIntersections = 0
    for (const index of ownerSegmentIndexes) {
      if (
        this.REGION_COST_MODEL === "routing-risk" &&
        (newLesserAngle === cache.lesserAngles[index] ||
          newLesserAngle === cache.greaterAngles[index] ||
          newGreaterAngle === cache.lesserAngles[index] ||
          newGreaterAngle === cache.greaterAngles[index])
      ) {
        continue
      }
      const lesserAngleIsInsideInterval =
        newLesserAngle < cache.lesserAngles[index]! &&
        cache.lesserAngles[index]! < newGreaterAngle
      const greaterAngleIsInsideInterval =
        newLesserAngle < cache.greaterAngles[index]! &&
        cache.greaterAngles[index]! < newGreaterAngle
      if (lesserAngleIsInsideInterval === greaterAngleIsInsideInterval) {
        continue
      }
      const intersectionKind = classifyIntersectionLayerMasks(
        newLayerMask,
        cache.layerMasks[index]!,
        this.REGION_COST_MODEL,
      )
      if (intersectionKind === "same-layer") sameLayerIntersections += 1
      else if (intersectionKind === "transition-pair") {
        crossingLayerIntersections += 1
      }
    }
    return [sameLayerIntersections, crossingLayerIntersections]
  }

  protected override computeRegionCostAfterAddingSegment(
    regionId: RegionId,
    currentPortId: PortId,
    neighborPortId: PortId,
  ): number {
    const memo = this.getActiveReplacementRegionCostMemo(regionId)
    const currentLocalIndex = this.getRegionLocalPortIndex(
      regionId,
      currentPortId,
    )
    const neighborLocalIndex = this.getRegionLocalPortIndex(
      regionId,
      neighborPortId,
    )
    if (currentLocalIndex < 0 || neighborLocalIndex < 0) {
      return super.computeRegionCostAfterAddingSegment(
        regionId,
        currentPortId,
        neighborPortId,
      )
    }
    const lesserLocalIndex = Math.min(currentLocalIndex, neighborLocalIndex)
    const greaterLocalIndex = Math.max(currentLocalIndex, neighborLocalIndex)
    const finalCostsByLocalPort =
      memo.finalCostsByLocalPort ?? memo.scorer.sharedFinalCostsByLocalPort
    const cachedFinalCost =
      finalCostsByLocalPort[lesserLocalIndex]?.[greaterLocalIndex]
    if (cachedFinalCost !== undefined && !Number.isNaN(cachedFinalCost)) {
      this.replacementRegionCostCacheHitCount += 1
      return cachedFinalCost
    }

    this.replacementRegionCostCacheMissCount += 1
    const geometry = this.populateSegmentGeometryScratch(
      regionId,
      currentPortId,
      neighborPortId,
    )
    let sameLayerIntersections = 0
    let crossingLayerIntersections = 0
    let entryExitLayerChanges = geometry.entryExitLayerChanges

    if (this.REGION_COST_MODEL === "routing-risk" && memo.ownerSegmentIndexes) {
      // Match the routing-risk model's route re-entry semantics exactly: only
      // the first chord owned by a route contributes crossings or transitions.
      entryExitLayerChanges = 0
    } else {
      let packedCountsRow =
        memo.scorer.packedIntersectionCountsByLocalPort[lesserLocalIndex]
      let packedCounts = packedCountsRow?.[greaterLocalIndex] ?? 0
      if (packedCounts === 0) {
        countNewIntersectionsWithValuesInto(
          memo.sourceCache,
          memo.scorer.absentOwnerId,
          geometry.lesserAngle,
          geometry.greaterAngle,
          geometry.layerMask,
          geometry.entryExitLayerChanges,
          this.REGION_COST_MODEL,
          this.replacementIntersectionCountsScratch,
        )
        sameLayerIntersections = this.replacementIntersectionCountsScratch[0]!
        crossingLayerIntersections =
          this.replacementIntersectionCountsScratch[1]!
        packedCounts =
          sameLayerIntersections * memo.scorer.intersectionCountStride +
          crossingLayerIntersections +
          1
        if (!packedCountsRow) {
          packedCountsRow = new Float64Array(memo.scorer.regionPortCount)
          memo.scorer.packedIntersectionCountsByLocalPort[lesserLocalIndex] =
            packedCountsRow
        }
        packedCountsRow[greaterLocalIndex] = packedCounts
      } else {
        const counts = packedCounts - 1
        sameLayerIntersections = Math.floor(
          counts / memo.scorer.intersectionCountStride,
        )
        crossingLayerIntersections =
          counts % memo.scorer.intersectionCountStride
      }

      if (memo.ownerSegmentIndexes) {
        const [ownerSameLayerIntersections, ownerCrossingLayerIntersections] =
          this.countOwnerChordIntersections(
            memo.sourceCache,
            memo.ownerSegmentIndexes,
            geometry.lesserAngle,
            geometry.greaterAngle,
            geometry.layerMask,
          )
        sameLayerIntersections -= ownerSameLayerIntersections
        crossingLayerIntersections -= ownerCrossingLayerIntersections
      }
    }

    const cost =
      sameLayerIntersections > 0 && this.isKnownSingleLayerRegion(regionId)
        ? Number.POSITIVE_INFINITY
        : this.computeRegionCostForRegion(
            regionId,
            memo.sourceCache.existingSameLayerIntersections +
              sameLayerIntersections,
            memo.sourceCache.existingCrossingLayerIntersections +
              crossingLayerIntersections,
            memo.sourceCache.existingEntryExitLayerChanges +
              entryExitLayerChanges,
            memo.sourceCache.existingSegmentCount + 1,
          )
    let finalCostsRow = finalCostsByLocalPort[lesserLocalIndex]
    if (!finalCostsRow) {
      finalCostsRow = new Float64Array(memo.scorer.regionPortCount).fill(
        Number.NaN,
      )
      finalCostsByLocalPort[lesserLocalIndex] = finalCostsRow
    }
    finalCostsRow[greaterLocalIndex] = cost
    return cost
  }

  getReplacementState() {
    return {
      portAssignment: new Int32Array(this.state.portAssignment),
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
    }
  }

  getReplacementPath(routeId: RouteId): ReplacementPathSegment[] {
    return [...(this.replacementPathByRouteId.get(routeId) ?? [])]
  }

  loadReplacementPath(
    inputSolver: TinyHyperGraphSolver,
    routeId: RouteId,
    congestionFactor: number,
    path: ReplacementPathSegment[],
  ): boolean {
    return this.loadReplacementPaths(
      inputSolver,
      [{ routeId, path }],
      congestionFactor,
    )
  }

  loadReplacementPaths(
    inputSolver: TinyHyperGraphSolver,
    replacements: Array<{
      routeId: RouteId
      path: ReplacementPathSegment[]
    }>,
    congestionFactor: number,
  ): boolean {
    this.resetForRoutes(
      inputSolver,
      replacements.map(({ routeId }) => routeId),
      congestionFactor,
    )

    for (const { routeId, path } of replacements) {
      const routeNetId = this.problem.routeNet[routeId]!
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = routeNetId
      const touchedRegionIds = new Set<RegionId>()

      for (const { regionId, fromPortId, toPortId } of path) {
        if (
          this.isReplacementSegmentAllowed &&
          !this.isReplacementSegmentAllowed(
            routeId,
            regionId,
            fromPortId,
            toPortId,
          )
        ) {
          return false
        }
        if (this.isRegionReservedForDifferentNet(regionId)) return false
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            return false
          }
        }

        if (this.writableRegionMask[regionId] === 0) {
          this.state.regionSegments[regionId] = [
            ...this.state.regionSegments[regionId]!,
          ]
          this.writableRegionMask[regionId] = 1
          this.writableRegionIds.push(regionId)
        }
        this.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        this.state.portAssignment[fromPortId] = routeNetId
        this.state.portAssignment[toPortId] = routeNetId
        touchedRegionIds.add(regionId)
      }

      for (const regionId of touchedRegionIds) {
        this.state.regionSegments[regionId]!.sort(
          (left, right) => left[0] - right[0],
        )
        this.rebuildRegionCache(regionId)
      }
      this.replacementPathByRouteId.set(routeId, [...path])
      this.replacementRouteSegmentCountByRouteId[routeId] = path.length
      let layerChangeCount = 0
      let segmentLength = 0
      for (const { fromPortId, toPortId } of path) {
        if (this.topology.portZ[fromPortId] !== this.topology.portZ[toPortId]) {
          layerChangeCount += 1
        }
        segmentLength += Math.hypot(
          this.topology.portX[toPortId]! - this.topology.portX[fromPortId]!,
          this.topology.portY[toPortId]! - this.topology.portY[fromPortId]!,
        )
      }
      this.replacementRouteLayerChangeCountByRouteId[routeId] = layerChangeCount
      this.replacementRouteSegmentLengthByRouteId[routeId] = segmentLength
      this.replacementRouteSegmentCount += path.length
    }

    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.solved = true
    return true
  }

  rescoreForOptimizer(inputSolver: TinyHyperGraphSolver) {
    this.TRACE_DENSITY_COST_FACTOR = inputSolver.TRACE_DENSITY_COST_FACTOR
    this.REGION_COST_MODEL = inputSolver.REGION_COST_MODEL
    for (const regionId of this.writableRegionIds) {
      this.rebuildRegionCache(regionId)
    }
  }

  getChangedRegionIds(): readonly RegionId[] {
    return this.writableRegionIds
  }

  private rebuildRegionCache(regionId: RegionId) {
    this.state.regionSegments[regionId]!.sort(
      (left, right) => left[0] - right[0],
    )
    this.state.regionIntersectionCaches[regionId] =
      createEmptyRegionIntersectionCache()
    for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
      regionId
    ]!) {
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = this.problem.routeNet[routeId]
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
  }

  override onOutOfCandidates() {
    this.failed = true
    this.error = "No replacement path was found for the selected route"
  }
}

/**
 * Improves a solved hypergraph with alternating atomic boundary permutations,
 * graph-wide route replacements, and dependency-guided two-route ejection
 * chains. Boundary mutations change both sides together, and replacement
 * candidates retain every route outside their exact ejection set. Peak-cost
 * reductions are accepted only when downstream routing risk does not worsen;
 * plateau moves may form a temporary ejection chain, which is relinked toward
 * the solved input after the final peak has been established.
 */
export class UnravelTinyHyperGraphSolver extends TinyHyperGraphSolver {
  MAX_MUTATIONS = Number.POSITIVE_INFINITY
  MAX_REROUTE_MUTATIONS = Number.POSITIVE_INFINITY
  MAX_HOT_REGIONS = Number.POSITIVE_INFINITY
  REROUTE_MAX_ITERATIONS = Number.POSITIVE_INFINITY
  MAX_REROUTE_ROUTES = Number.POSITIVE_INFINITY
  // The core path cost already includes the exact marginal region cost.
  // Search that deterministic objective once; physical-risk invariants are
  // enforced when the completed replacement is scored.
  REROUTE_CONGESTION_FACTORS = [0]
  MAX_REROUTE_SEGMENT_INCREASE = Number.POSITIVE_INFINITY

  readonly inputSolver: TinyHyperGraphSolver
  initialSummary: UnravelRegionCostSummary
  currentSummary: UnravelRegionCostSummary
  acceptedMutationCount = 0
  acceptedSwapMutationCount = 0
  acceptedCycleMutationCount = 0
  acceptedRerouteMutationCount = 0
  acceptedPairRerouteMutationCount = 0
  evaluatedMutationCount = 0
  rejectedRerouteDetourCount = 0
  rejectedRerouteLayerChangeCount = 0
  rejectedReroutePhysicalRiskCount = 0
  rejectedRerouteEndpointKeepoutCount = 0
  prunedRerouteEndpointKeepoutSegmentCount = 0
  rejectedBoundaryEndpointKeepoutCount = 0
  rejectedFixedBoundaryOrderCount = 0
  terminalKeepoutBroadPhaseQueryCount = 0
  terminalKeepoutBroadPhaseCandidateCount = 0
  terminalKeepoutExactCheckCount = 0
  terminalKeepoutGeometryCacheHitCount = 0
  terminalKeepoutNeighborPartitionCacheHitCount = 0
  terminalKeepoutNeighborPartitionCacheMissCount = 0
  rejectedCrossLayerSwapCount = 0
  prunedRerouteSearchCount = 0
  rerouteSearchIterationCount = 0
  rerouteSearchCount = 0
  singleRerouteSearchIterationCount = 0
  singleRerouteSearchCount = 0
  singleRerouteFailedSearchIterationCount = 0
  singleRerouteFailedSearchCount = 0
  pairRerouteSearchIterationCount = 0
  pairRerouteSearchCount = 0
  pairRerouteFailedSearchIterationCount = 0
  pairRerouteFailedSearchCount = 0
  reusedRerouteCandidateCount = 0
  revertedBoundaryMutationCount = 0
  revertedRerouteMutationCount = 0
  readonly fixedRouteCount: number

  private readonly endpointPortMask: Int8Array
  private readonly fixedRouteMask: Int8Array
  private readonly initialRouteSegmentCounts: Int32Array
  private readonly routeLayerChangeCountByRouteId: Int32Array
  private readonly routeSegmentLengthByRouteId: Float64Array
  private readonly terminalKeepouts: IndexedTerminalKeepout[]
  private readonly terminalKeepoutCellSize: number
  private readonly terminalKeepoutIndexesByRegion: Int32Array[]
  private readonly terminalKeepoutGeometryIndexByRegion: Int32Array[]
  private readonly terminalKeepoutGeometries: CachedTerminalKeepoutGeometry[] =
    []
  private readonly terminalKeepoutNeighborPartitionByHop = new Map<
    number,
    TerminalKeepoutNeighborPartition
  >()
  private readonly firstIncidentRegionPortIndex: Int32Array
  private readonly secondIncidentRegionPortIndex: Int32Array
  private readonly overflowIncidentRegionPortIndex = new Map<number, number>()
  private readonly hasForeignEndpointKeepouts: boolean
  private readonly routeForeignEndpointClearancesByRouteId: Float64Array[]
  private readonly routingRiskOwnerByRouteId: Int32Array
  private readonly physicalPointIdByPortId: Int32Array
  private routingRiskByRegion: Float64Array
  private segmentRoutingRiskByRegion: Float64Array
  private downstreamRiskByRegion: Float64Array
  private segmentLengthByRegion: Float64Array
  private routeReplacementSolver?: SingleRouteReplacementSolver
  private pendingReroutePaths: CachedReroutePath[] = []
  private readonly acceptedBoundaryMutations: BoundaryMutation[] = []
  private readonly revertedBoundaryMutations = new Set<BoundaryMutation>()
  private readonly acceptedRerouteMutations: AcceptedRerouteMutation[] = []
  private readonly rerouteBlockingRouteIdsByRouteId = new Map<
    RouteId,
    RouteId[]
  >()
  private optimizationPhase: "initial_untwist" | "reroute" | "final_untwist" =
    "initial_untwist"
  private reachedRerouteLimit = false

  get replacementRegionCostCacheHitCount() {
    return this.routeReplacementSolver?.replacementRegionCostCacheHitCount ?? 0
  }

  get replacementRegionCostCacheMissCount() {
    return this.routeReplacementSolver?.replacementRegionCostCacheMissCount ?? 0
  }

  constructor(
    inputSolver: TinyHyperGraphSolver,
    options?: UnravelTinyHyperGraphSolverOptions,
  ) {
    if (!inputSolver.solved || inputSolver.failed) {
      throw new Error(
        "UnravelTinyHyperGraphSolver requires a successfully solved input solver",
      )
    }

    super(
      inputSolver.topology,
      inputSolver.problem,
      getUnravelCoreOptions(inputSolver, options),
    )
    this.inputSolver = inputSolver
    this.fixedRouteMask = new Int8Array(this.problem.routeCount)
    for (const routeId of new Set(options?.FIXED_ROUTE_IDS ?? [])) {
      if (
        !Number.isInteger(routeId) ||
        routeId < 0 ||
        routeId >= this.problem.routeCount
      ) {
        throw new Error(`Invalid fixed route id: ${routeId}`)
      }
      this.fixedRouteMask[routeId] = 1
    }
    this.fixedRouteCount = this.fixedRouteMask.reduce(
      (count, isFixed) => count + isFixed,
      0,
    )
    if (options?.MAX_MUTATIONS !== undefined) {
      this.MAX_MUTATIONS = Math.max(0, Math.floor(options.MAX_MUTATIONS))
    }
    if (options?.MAX_REROUTE_MUTATIONS !== undefined) {
      this.MAX_REROUTE_MUTATIONS = Math.max(
        0,
        Math.floor(options.MAX_REROUTE_MUTATIONS),
      )
    }
    if (options?.MAX_HOT_REGIONS !== undefined) {
      this.MAX_HOT_REGIONS = Math.max(0, Math.floor(options.MAX_HOT_REGIONS))
    }
    if (options?.REROUTE_MAX_ITERATIONS !== undefined) {
      this.REROUTE_MAX_ITERATIONS = Math.max(
        1,
        Math.floor(options.REROUTE_MAX_ITERATIONS),
      )
    }
    if (options?.MAX_REROUTE_ROUTES !== undefined) {
      this.MAX_REROUTE_ROUTES = Math.max(
        0,
        Math.floor(options.MAX_REROUTE_ROUTES),
      )
    }
    if (options?.REROUTE_CONGESTION_FACTORS !== undefined) {
      this.REROUTE_CONGESTION_FACTORS = [...options.REROUTE_CONGESTION_FACTORS]
        .filter((factor) => Number.isFinite(factor) && factor >= 0)
        .sort((left, right) => left - right)
    }
    if (options?.MAX_REROUTE_SEGMENT_INCREASE !== undefined) {
      this.MAX_REROUTE_SEGMENT_INCREASE = Math.max(
        0,
        Math.floor(options.MAX_REROUTE_SEGMENT_INCREASE),
      )
    }
    this.state.portAssignment = new Int32Array(inputSolver.state.portAssignment)
    this.state.regionSegments = inputSolver.state.regionSegments.map(
      (segments) =>
        segments.map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
        ),
    )
    this.state.regionIntersectionCaches =
      inputSolver.state.regionIntersectionCaches.map(
        cloneRegionIntersectionCache,
      )
    this.state.regionCongestionCost = new Float64Array(
      inputSolver.state.regionCongestionCost,
    )
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1

    // Serialized solutions replay routes in route-id order. The legacy chord
    // predicate has endpoint-equality semantics that depend on insertion order,
    // so keep the optimizer's caches in that same canonical order. Otherwise a
    // swap can appear cheap internally and become expensive after getOutput()
    // is loaded by the next pipeline stage.
    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      this.rebuildRegionCache(regionId)
    }

    this.endpointPortMask = new Int8Array(this.topology.portCount)
    this.initialRouteSegmentCounts = new Int32Array(this.problem.routeCount)
    this.routeLayerChangeCountByRouteId = new Int32Array(
      this.problem.routeCount,
    )
    this.routeSegmentLengthByRouteId = new Float64Array(this.problem.routeCount)
    this.routingRiskOwnerByRouteId = new Int32Array(this.problem.routeCount)
    this.physicalPointIdByPortId = new Int32Array(this.topology.portCount)
    const physicalPointIdByKey = new Map<string, number>()
    for (let portId = 0; portId < this.topology.portCount; portId++) {
      const key = `${this.topology.portX[portId]},${this.topology.portY[portId]},${this.topology.portZ[portId]}`
      let physicalPointId = physicalPointIdByKey.get(key)
      if (physicalPointId === undefined) {
        physicalPointId = physicalPointIdByKey.size
        physicalPointIdByKey.set(key, physicalPointId)
      }
      this.physicalPointIdByPortId[portId] = physicalPointId
    }
    const routingRiskOwnerIdByName = new Map<string, number>()
    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const metadata = this.problem.routeMetadata?.[routeId] as
        | {
            connectionId?: unknown
            simpleRouteConnection?: { name?: unknown }
          }
        | undefined
      const ownerName =
        typeof metadata?.simpleRouteConnection?.name === "string"
          ? metadata.simpleRouteConnection.name
          : typeof metadata?.connectionId === "string"
            ? metadata.connectionId
            : `route-${routeId}`
      let ownerId = routingRiskOwnerIdByName.get(ownerName)
      if (ownerId === undefined) {
        ownerId = routingRiskOwnerIdByName.size
        routingRiskOwnerIdByName.set(ownerName, ownerId)
      }
      this.routingRiskOwnerByRouteId[routeId] = ownerId
      this.endpointPortMask[this.problem.routeStartPort[routeId]!] = 1
      this.endpointPortMask[this.problem.routeEndPort[routeId]!] = 1
    }
    const getTerminalKeepouts = (portId: PortId): TerminalKeepout[] => {
      const metadata = this.topology.portMetadata?.[portId] as
        | { _tinyTerminalKeepouts?: unknown }
        | undefined
      if (!Array.isArray(metadata?._tinyTerminalKeepouts)) return []
      return metadata._tinyTerminalKeepouts.filter(
        (candidate): candidate is TerminalKeepout =>
          typeof candidate === "object" &&
          candidate !== null &&
          ["minX", "minY", "maxX", "maxY", "z", "traceCenterClearance"].every(
            (key) =>
              Number.isFinite(
                (candidate as Record<string, unknown>)[key] as number,
              ),
          ) &&
          ((candidate as Record<string, unknown>).viaCenterClearance ===
            undefined ||
            Number.isFinite(
              (candidate as Record<string, unknown>)
                .viaCenterClearance as number,
            )) &&
          (candidate as TerminalKeepout).minX <=
            (candidate as TerminalKeepout).maxX &&
          (candidate as TerminalKeepout).minY <=
            (candidate as TerminalKeepout).maxY &&
          (candidate as TerminalKeepout).traceCenterClearance >= 0 &&
          ((candidate as TerminalKeepout).viaCenterClearance ?? 0) >= 0,
      )
    }
    const terminalKeepoutByKey = new Map<string, IndexedTerminalKeepout>()
    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const netId = this.problem.routeNet[routeId]!
      for (const portId of [
        this.problem.routeStartPort[routeId]!,
        this.problem.routeEndPort[routeId]!,
      ]) {
        for (const keepout of getTerminalKeepouts(portId)) {
          const key = [
            netId,
            keepout.minX,
            keepout.minY,
            keepout.maxX,
            keepout.maxY,
            keepout.z,
            keepout.traceCenterClearance,
            keepout.viaCenterClearance ?? keepout.traceCenterClearance,
          ].join(":")
          if (!terminalKeepoutByKey.has(key)) {
            terminalKeepoutByKey.set(key, { ...keepout, netId })
          }
        }
      }
    }
    this.terminalKeepouts = [...terminalKeepoutByKey.values()]
    this.hasForeignEndpointKeepouts =
      this.terminalKeepouts.length > 0 &&
      new Set(this.problem.routeNet).size > 1
    // Retain the largest envelope size as a diagnostic, and index every
    // keepout against the exact rectangular region bounds. Every region-local
    // chord lies inside its convex region, so a keepout whose fully inflated
    // envelope misses that region cannot constrain any of its port pairs.
    // This is an admissible topology-level broad phase rather than a sampling
    // radius or board-size-dependent cutoff.
    this.terminalKeepoutCellSize = this.hasForeignEndpointKeepouts
      ? Math.max(
          ...this.terminalKeepouts.map((keepout) => {
            const expansion = Math.max(
              keepout.traceCenterClearance,
              keepout.viaCenterClearance ?? keepout.traceCenterClearance,
            )
            return Math.max(
              keepout.maxX - keepout.minX + expansion * 2,
              keepout.maxY - keepout.minY + expansion * 2,
            )
          }),
          COST_EPSILON,
        )
      : 1
    this.terminalKeepoutIndexesByRegion = Array.from(
      { length: this.topology.regionCount },
      (_, regionId) => {
        const centerX = this.topology.regionCenterX[regionId]!
        const centerY = this.topology.regionCenterY[regionId]!
        const halfWidth = this.topology.regionWidth[regionId]! / 2
        const halfHeight = this.topology.regionHeight[regionId]! / 2
        let regionMinX = centerX - halfWidth
        let regionMinY = centerY - halfHeight
        let regionMaxX = centerX + halfWidth
        let regionMaxY = centerY + halfHeight
        // Include every incident port so this remains conservative when a
        // caller supplies stale or synthetic region geometry.
        for (const portId of this.topology.regionIncidentPorts[regionId]!) {
          regionMinX = Math.min(regionMinX, this.topology.portX[portId]!)
          regionMinY = Math.min(regionMinY, this.topology.portY[portId]!)
          regionMaxX = Math.max(regionMaxX, this.topology.portX[portId]!)
          regionMaxY = Math.max(regionMaxY, this.topology.portY[portId]!)
        }
        const availableZMask =
          this.topology.regionAvailableZMask?.[regionId] ?? 0
        return Int32Array.from(
          this.terminalKeepouts.flatMap((keepout, keepoutIndex) => {
            if (
              availableZMask !== 0 &&
              (availableZMask & (1 << keepout.z)) === 0
            ) {
              return []
            }
            const expansion = Math.max(
              keepout.traceCenterClearance,
              keepout.viaCenterClearance ?? keepout.traceCenterClearance,
            )
            return boundsOverlap(
              regionMinX,
              regionMinY,
              regionMaxX,
              regionMaxY,
              keepout.minX - expansion,
              keepout.minY - expansion,
              keepout.maxX + expansion,
              keepout.maxY + expansion,
            )
              ? [keepoutIndex]
              : []
          }),
        )
      },
    )
    if (this.hasForeignEndpointKeepouts) {
      this.firstIncidentRegionPortIndex = new Int32Array(
        this.topology.portCount,
      ).fill(-1)
      this.secondIncidentRegionPortIndex = new Int32Array(
        this.topology.portCount,
      ).fill(-1)
      this.terminalKeepoutGeometryIndexByRegion =
        this.topology.regionIncidentPorts.map((portIds, regionId) => {
          const geometryIndexes = new Int32Array(
            portIds.length * portIds.length,
          ).fill(-1)
          for (let portIndex = 0; portIndex < portIds.length; portIndex++) {
            const portId = portIds[portIndex]!
            const incidentRegionIds = this.topology.incidentPortRegion[portId]!
            if (incidentRegionIds[0] === regionId) {
              this.firstIncidentRegionPortIndex[portId] = portIndex
            } else if (incidentRegionIds[1] === regionId) {
              this.secondIncidentRegionPortIndex[portId] = portIndex
            } else {
              this.overflowIncidentRegionPortIndex.set(
                portId * this.topology.regionCount + regionId,
                portIndex,
              )
            }
          }
          return geometryIndexes
        })
    } else {
      this.firstIncidentRegionPortIndex = new Int32Array(0)
      this.secondIncidentRegionPortIndex = new Int32Array(0)
      this.terminalKeepoutGeometryIndexByRegion = []
    }
    this.routeForeignEndpointClearancesByRouteId = Array.from(
      { length: this.problem.routeCount },
      () => new Float64Array(this.terminalKeepouts.length),
    )
    for (const segments of this.state.regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments) {
        this.initialRouteSegmentCounts[routeId] += 1
        if (this.topology.portZ[fromPortId] !== this.topology.portZ[toPortId]) {
          this.routeLayerChangeCountByRouteId[routeId] += 1
        }
        this.routeSegmentLengthByRouteId[routeId] += this.computeSegmentLength(
          this,
          fromPortId,
          toPortId,
        )
      }
    }
    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      this.routeForeignEndpointClearancesByRouteId[routeId] =
        this.computeRouteForeignEndpointClearances(this, routeId)
    }

    const initialScoredState = this.summarizeSolverState(this)
    this.routingRiskByRegion = initialScoredState.routingRiskByRegion
    this.segmentRoutingRiskByRegion =
      initialScoredState.segmentRoutingRiskByRegion
    this.downstreamRiskByRegion = initialScoredState.downstreamRiskByRegion
    this.segmentLengthByRegion = initialScoredState.segmentLengthByRegion
    this.initialSummary = initialScoredState.summary
    this.currentSummary = { ...this.initialSummary }
  }

  override _setup() {
    this.stats = {
      ...this.stats,
      initialMaxRegionCost: this.initialSummary.maxRegionCost,
      initialTotalRegionCost: this.initialSummary.totalRegionCost,
      initialTotalSegmentLength: this.initialSummary.totalSegmentLength,
      initialMaxRoutingRisk: this.initialSummary.maxRoutingRisk,
      initialTotalRoutingRisk: this.initialSummary.totalRoutingRisk,
      initialMaxSegmentRoutingRisk: this.initialSummary.maxSegmentRoutingRisk,
      initialTotalSegmentRoutingRisk:
        this.initialSummary.totalSegmentRoutingRisk,
      initialMaxDownstreamRisk: this.initialSummary.maxDownstreamRisk,
      initialTotalDownstreamRisk: this.initialSummary.totalDownstreamRisk,
      initialMinForeignEndpointClearance:
        this.getMinimumForeignEndpointClearance(),
      fixedRouteCount: this.fixedRouteCount,
      finalMaxRegionCost: this.currentSummary.maxRegionCost,
      finalTotalRegionCost: this.currentSummary.totalRegionCost,
      finalTotalSegmentLength: this.currentSummary.totalSegmentLength,
      finalMaxRoutingRisk: this.currentSummary.maxRoutingRisk,
      finalTotalRoutingRisk: this.currentSummary.totalRoutingRisk,
      finalMaxSegmentRoutingRisk: this.currentSummary.maxSegmentRoutingRisk,
      finalTotalSegmentRoutingRisk: this.currentSummary.totalSegmentRoutingRisk,
      finalMaxDownstreamRisk: this.currentSummary.maxDownstreamRisk,
      finalTotalDownstreamRisk: this.currentSummary.totalDownstreamRisk,
      finalMinForeignEndpointClearance:
        this.getMinimumForeignEndpointClearance(),
      acceptedMutationCount: 0,
      acceptedSwapMutationCount: 0,
      acceptedCycleMutationCount: 0,
      acceptedRerouteMutationCount: 0,
      acceptedPairRerouteMutationCount: 0,
      evaluatedMutationCount: 0,
      rejectedRerouteDetourCount: 0,
      rejectedRerouteLayerChangeCount: 0,
      rejectedReroutePhysicalRiskCount: 0,
      rejectedRerouteEndpointKeepoutCount: 0,
      prunedRerouteEndpointKeepoutSegmentCount: 0,
      rejectedBoundaryEndpointKeepoutCount: 0,
      rejectedFixedBoundaryOrderCount: 0,
      terminalKeepoutCount: this.terminalKeepouts.length,
      terminalKeepoutCellSize: this.terminalKeepoutCellSize,
      terminalKeepoutBroadPhaseQueryCount:
        this.terminalKeepoutBroadPhaseQueryCount,
      terminalKeepoutBroadPhaseCandidateCount:
        this.terminalKeepoutBroadPhaseCandidateCount,
      terminalKeepoutExactCheckCount: this.terminalKeepoutExactCheckCount,
      terminalKeepoutGeometryCacheHitCount:
        this.terminalKeepoutGeometryCacheHitCount,
      terminalKeepoutNeighborPartitionCacheHitCount:
        this.terminalKeepoutNeighborPartitionCacheHitCount,
      terminalKeepoutNeighborPartitionCacheMissCount:
        this.terminalKeepoutNeighborPartitionCacheMissCount,
      terminalKeepoutGeometryCacheSize: this.terminalKeepoutGeometries.length,
      terminalKeepoutPhysicalNeighborCacheHitCount: 0,
      terminalKeepoutPhysicalNeighborCacheMissCount: 0,
      replacementRegionCostCacheHitCount: 0,
      replacementRegionCostCacheMissCount: 0,
      rejectedCrossLayerSwapCount: 0,
      prunedRerouteSearchCount: 0,
      rerouteSearchIterationCount: 0,
      rerouteSearchCount: 0,
      singleRerouteSearchIterationCount: 0,
      singleRerouteSearchCount: 0,
      singleRerouteFailedSearchIterationCount: 0,
      singleRerouteFailedSearchCount: 0,
      pairRerouteSearchIterationCount: 0,
      pairRerouteSearchCount: 0,
      pairRerouteFailedSearchIterationCount: 0,
      pairRerouteFailedSearchCount: 0,
      reusedRerouteCandidateCount: 0,
      revertedBoundaryMutationCount: 0,
      revertedRerouteMutationCount: 0,
    }

    if (this.MAX_MUTATIONS === 0) {
      this.finishOptimization("mutation_limit")
    }
  }

  override _step() {
    if (this.acceptedMutationCount >= this.MAX_MUTATIONS) {
      this.finishOptimization("mutation_limit")
      return
    }

    // Exhaust the cheap local untwist neighborhood before changing a whole
    // route, and normalize again after every accepted replacement. Comparing
    // reroutes from locally untwisted states avoids letting a temporary port
    // ordering artifact steer the next global search.
    let mutation: BoundaryMutation | RerouteMutation | undefined
    while (!mutation) {
      if (this.optimizationPhase === "initial_untwist") {
        mutation = this.findBestSwapMutation() ?? this.findBestCycleMutation()
        if (!mutation) this.optimizationPhase = "reroute"
        continue
      }

      if (this.optimizationPhase === "reroute") {
        if (this.acceptedRerouteMutationCount >= this.MAX_REROUTE_MUTATIONS) {
          this.reachedRerouteLimit = true
          this.optimizationPhase = "final_untwist"
          continue
        }
        // Follow first-order descent to a one-route local optimum before
        // opening the much larger pair-ejection neighborhood. A paired search
        // is a repair mechanism for dependencies that no single replacement
        // can escape; running it as a portfolio against every available
        // single replacement repeats quadratic work that the next locally
        // untwisted state may make irrelevant.
        mutation = this.findBestRerouteMutation()
        mutation ??= this.findBestPairRerouteMutation()
        if (!mutation) this.optimizationPhase = "final_untwist"
        continue
      }

      mutation = this.findBestSwapMutation() ?? this.findBestCycleMutation()
      if (!mutation) {
        this.finishOptimization(
          this.reachedRerouteLimit ? "reroute_limit" : "local_optimum",
        )
        return
      }
    }

    if (mutation.kind === "reroute") {
      this.acceptedRerouteMutations.push({
        routeIds: [...mutation.routeIds],
        previousPaths: mutation.routeIds.map((routeId) => ({
          routeId,
          path: this.getRoutePath(routeId),
        })),
        reverted: false,
      })
      this.applyRerouteMutation(mutation)
      this.acceptedRerouteMutationCount += 1
      if (mutation.routeIds.length === 2) {
        this.acceptedPairRerouteMutationCount += 1
      }
      this.optimizationPhase = "initial_untwist"
    } else {
      this.applyBoundaryMutation(mutation)
      this.acceptedBoundaryMutations.push(mutation)
      if (mutation.kind === "swap") {
        this.acceptedSwapMutationCount += 1
      } else {
        this.acceptedCycleMutationCount += 1
        this.optimizationPhase = "initial_untwist"
      }
    }
    this.acceptedMutationCount += 1
    this.currentSummary = mutation.summary
    this.stats = {
      ...this.stats,
      finalMaxRegionCost: this.currentSummary.maxRegionCost,
      finalTotalRegionCost: this.currentSummary.totalRegionCost,
      finalTotalSegmentLength: this.currentSummary.totalSegmentLength,
      finalMaxRoutingRisk: this.currentSummary.maxRoutingRisk,
      finalTotalRoutingRisk: this.currentSummary.totalRoutingRisk,
      finalMaxSegmentRoutingRisk: this.currentSummary.maxSegmentRoutingRisk,
      finalTotalSegmentRoutingRisk: this.currentSummary.totalSegmentRoutingRisk,
      finalMaxDownstreamRisk: this.currentSummary.maxDownstreamRisk,
      finalTotalDownstreamRisk: this.currentSummary.totalDownstreamRisk,
      finalMinForeignEndpointClearance:
        this.getMinimumForeignEndpointClearance(),
      acceptedMutationCount: this.acceptedMutationCount,
      acceptedSwapMutationCount: this.acceptedSwapMutationCount,
      acceptedCycleMutationCount: this.acceptedCycleMutationCount,
      acceptedRerouteMutationCount: this.acceptedRerouteMutationCount,
      acceptedPairRerouteMutationCount: this.acceptedPairRerouteMutationCount,
      evaluatedMutationCount: this.evaluatedMutationCount,
      rejectedRerouteDetourCount: this.rejectedRerouteDetourCount,
      rejectedRerouteLayerChangeCount: this.rejectedRerouteLayerChangeCount,
      rejectedReroutePhysicalRiskCount: this.rejectedReroutePhysicalRiskCount,
      rejectedRerouteEndpointKeepoutCount:
        this.rejectedRerouteEndpointKeepoutCount,
      prunedRerouteEndpointKeepoutSegmentCount:
        this.prunedRerouteEndpointKeepoutSegmentCount,
      rejectedBoundaryEndpointKeepoutCount:
        this.rejectedBoundaryEndpointKeepoutCount,
      rejectedFixedBoundaryOrderCount: this.rejectedFixedBoundaryOrderCount,
      terminalKeepoutCount: this.terminalKeepouts.length,
      terminalKeepoutCellSize: this.terminalKeepoutCellSize,
      terminalKeepoutBroadPhaseQueryCount:
        this.terminalKeepoutBroadPhaseQueryCount,
      terminalKeepoutBroadPhaseCandidateCount:
        this.terminalKeepoutBroadPhaseCandidateCount,
      terminalKeepoutExactCheckCount: this.terminalKeepoutExactCheckCount,
      terminalKeepoutGeometryCacheHitCount:
        this.terminalKeepoutGeometryCacheHitCount,
      terminalKeepoutNeighborPartitionCacheHitCount:
        this.terminalKeepoutNeighborPartitionCacheHitCount,
      terminalKeepoutNeighborPartitionCacheMissCount:
        this.terminalKeepoutNeighborPartitionCacheMissCount,
      terminalKeepoutGeometryCacheSize: this.terminalKeepoutGeometries.length,
      terminalKeepoutPhysicalNeighborCacheHitCount:
        this.routeReplacementSolver?.physicalNeighborCacheHitCount ?? 0,
      terminalKeepoutPhysicalNeighborCacheMissCount:
        this.routeReplacementSolver?.physicalNeighborCacheMissCount ?? 0,
      replacementRegionCostCacheHitCount:
        this.replacementRegionCostCacheHitCount,
      replacementRegionCostCacheMissCount:
        this.replacementRegionCostCacheMissCount,
      rejectedCrossLayerSwapCount: this.rejectedCrossLayerSwapCount,
      prunedRerouteSearchCount: this.prunedRerouteSearchCount,
      rerouteSearchIterationCount: this.rerouteSearchIterationCount,
      rerouteSearchCount: this.rerouteSearchCount,
      singleRerouteSearchIterationCount: this.singleRerouteSearchIterationCount,
      singleRerouteSearchCount: this.singleRerouteSearchCount,
      singleRerouteFailedSearchIterationCount:
        this.singleRerouteFailedSearchIterationCount,
      singleRerouteFailedSearchCount: this.singleRerouteFailedSearchCount,
      pairRerouteSearchIterationCount: this.pairRerouteSearchIterationCount,
      pairRerouteSearchCount: this.pairRerouteSearchCount,
      pairRerouteFailedSearchIterationCount:
        this.pairRerouteFailedSearchIterationCount,
      pairRerouteFailedSearchCount: this.pairRerouteFailedSearchCount,
      reusedRerouteCandidateCount: this.reusedRerouteCandidateCount,
      revertedBoundaryMutationCount: this.revertedBoundaryMutationCount,
      revertedRerouteMutationCount: this.revertedRerouteMutationCount,
      lastMutationKind: mutation.kind,
      ...(mutation.kind === "reroute"
        ? {
            lastMutationRouteId: mutation.routeId,
            lastMutationRouteIds: mutation.routeIds,
            lastMutationCongestionFactor: mutation.congestionFactor,
          }
        : {
            lastMutationPort1Id: mutation.permutation.slots[0]!.portId,
            lastMutationPort2Id: mutation.permutation.slots[1]!.portId,
            lastMutationRegion1Id: mutation.region1Id,
            lastMutationRegion2Id: mutation.region2Id,
          }),
    }
  }

  private computeRoutingRiskForCounts(
    regionId: RegionId,
    sameLayerIntersections: number,
    transitionPairIntersections: number,
    entryExitLayerChanges: number,
    traceCount = 0,
  ) {
    const metadata = this.topology.regionMetadata?.[regionId]
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      metadata._containsTarget === true
    ) {
      return 0
    }

    return computeRoutingRiskRegionCostWithPreparedCapacity(
      this.routingRiskCapacityByRegion[regionId]!,
      sameLayerIntersections,
      transitionPairIntersections,
      entryExitLayerChanges,
      traceCount,
    )
  }

  private remapPortForBoundaryPermutation(
    routeId: RouteId,
    portId: PortId,
    permutation?: BoundaryPermutation,
  ): PortId {
    if (!permutation) return portId
    for (let index = 0; index < permutation.slots.length; index++) {
      const source = permutation.slots[index]!
      if (source.routeId === routeId && source.portId === portId) {
        return permutation.destinationPortIds[index]!
      }
    }
    return portId
  }

  /**
   * Mirrors getIntraNodeCrossingsUsingCircle in the detailed router. In
   * particular, physical chords are grouped by SimpleRouteConnection name,
   * not electrical net or tiny route id, and only the first two distinct
   * points for a connection form its chord in a region.
   */
  private computePhysicalRoutingRisksForRegion(
    solver: TinyHyperGraphSolver,
    regionId: RegionId,
    options?: {
      removedRouteId?: RouteId
      removedRouteIds?: ReadonlySet<RouteId>
      permutation?: BoundaryPermutation
    },
  ) {
    const pointsByOwner = new Map<number, PortId[]>()
    const segments: Array<{
      routeId: RouteId
      fromPortId: PortId
      toPortId: PortId
      lesserAngle: number
      greaterAngle: number
      layerMask: number
    }> = []
    let segmentEntryExitLayerChanges = 0
    const addDistinctPoint = (ownerId: number, portId: PortId) => {
      const points = pointsByOwner.get(ownerId) ?? []
      if (
        !points.some(
          (existingPortId) =>
            this.physicalPointIdByPortId[existingPortId] ===
            this.physicalPointIdByPortId[portId],
        )
      ) {
        points.push(portId)
      }
      pointsByOwner.set(ownerId, points)
    }
    for (const [routeId, originalFromPortId, originalToPortId] of solver.state
      .regionSegments[regionId]!) {
      if (
        routeId === options?.removedRouteId ||
        options?.removedRouteIds?.has(routeId)
      ) {
        continue
      }
      const ownerId = this.routingRiskOwnerByRouteId[routeId]!
      const fromPortId = this.remapPortForBoundaryPermutation(
        routeId,
        originalFromPortId,
        options?.permutation,
      )
      const toPortId = this.remapPortForBoundaryPermutation(
        routeId,
        originalToPortId,
        options?.permutation,
      )
      addDistinctPoint(ownerId, fromPortId)
      addDistinctPoint(ownerId, toPortId)
      const geometry = this.populateSegmentGeometryScratch(
        regionId,
        fromPortId,
        toPortId,
      )
      segments.push({
        routeId,
        fromPortId,
        toPortId,
        lesserAngle: geometry.lesserAngle,
        greaterAngle: geometry.greaterAngle,
        layerMask: geometry.layerMask,
      })
      segmentEntryExitLayerChanges += geometry.entryExitLayerChanges
    }

    const lesserAngles: number[] = []
    const greaterAngles: number[] = []
    const layerMasks: number[] = []
    let entryExitLayerChanges = 0
    for (const points of pointsByOwner.values()) {
      if (points.length < 2) continue
      const geometry = this.populateSegmentGeometryScratch(
        regionId,
        points[0]!,
        points[1]!,
      )
      lesserAngles.push(geometry.lesserAngle)
      greaterAngles.push(geometry.greaterAngle)
      layerMasks.push(geometry.layerMask)
      entryExitLayerChanges += geometry.entryExitLayerChanges
    }

    let sameLayerIntersections = 0
    let transitionPairIntersections = 0
    for (let leftIndex = 0; leftIndex < lesserAngles.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < lesserAngles.length;
        rightIndex++
      ) {
        if (
          lesserAngles[leftIndex] === lesserAngles[rightIndex] ||
          lesserAngles[leftIndex] === greaterAngles[rightIndex] ||
          greaterAngles[leftIndex] === lesserAngles[rightIndex] ||
          greaterAngles[leftIndex] === greaterAngles[rightIndex]
        ) {
          continue
        }
        const intersects =
          (lesserAngles[rightIndex]! < lesserAngles[leftIndex]! &&
            lesserAngles[leftIndex]! < greaterAngles[rightIndex]!) !==
          (lesserAngles[rightIndex]! < greaterAngles[leftIndex]! &&
            greaterAngles[leftIndex]! < greaterAngles[rightIndex]!)
        if (!intersects) continue

        const intersectionKind = classifyIntersectionLayerMasks(
          layerMasks[leftIndex]!,
          layerMasks[rightIndex]!,
          "routing-risk",
        )
        if (intersectionKind === "same-layer") {
          sameLayerIntersections += 1
        } else if (intersectionKind === "transition-pair") {
          transitionPairIntersections += 1
        }
      }
    }

    const downstreamRisk = this.computeRoutingRiskForCounts(
      regionId,
      sameLayerIntersections,
      transitionPairIntersections,
      entryExitLayerChanges,
    )
    const groupedRisk = this.computeRoutingRiskForCounts(
      regionId,
      sameLayerIntersections,
      transitionPairIntersections,
      entryExitLayerChanges,
      pointsByOwner.size,
    )

    let segmentSameLayerIntersections = 0
    let segmentTransitionPairIntersections = 0
    for (let leftIndex = 0; leftIndex < segments.length; leftIndex++) {
      const left = segments[leftIndex]!
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < segments.length;
        rightIndex++
      ) {
        const right = segments[rightIndex]!
        if (left.routeId === right.routeId) continue
        const leftFromPointId = this.physicalPointIdByPortId[left.fromPortId]!
        const leftToPointId = this.physicalPointIdByPortId[left.toPortId]!
        const rightFromPointId = this.physicalPointIdByPortId[right.fromPortId]!
        const rightToPointId = this.physicalPointIdByPortId[right.toPortId]!
        if (
          leftFromPointId === rightFromPointId ||
          leftFromPointId === rightToPointId ||
          leftToPointId === rightFromPointId ||
          leftToPointId === rightToPointId
        ) {
          continue
        }
        const intersects =
          (right.lesserAngle < left.lesserAngle &&
            left.lesserAngle < right.greaterAngle) !==
          (right.lesserAngle < left.greaterAngle &&
            left.greaterAngle < right.greaterAngle)
        if (!intersects) continue
        const intersectionKind = classifyIntersectionLayerMasks(
          left.layerMask,
          right.layerMask,
          "routing-complexity",
        )
        if (intersectionKind === "same-layer") {
          segmentSameLayerIntersections += 1
        } else if (intersectionKind === "transition-pair") {
          segmentTransitionPairIntersections += 1
        }
      }
    }

    return {
      groupedRisk,
      downstreamRisk,
      segmentRisk: this.computeRoutingRiskForCounts(
        regionId,
        segmentSameLayerIntersections,
        segmentTransitionPairIntersections,
        segmentEntryExitLayerChanges,
        segments.length,
      ),
    }
  }

  private getBoundaryPortGroups(): BoundaryPortGroup[] {
    const occurrencesByPort = Array.from(
      { length: this.topology.portCount },
      () => [] as PortOccurrence[],
    )

    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        occurrencesByPort[fromPortId]!.push({
          regionId,
          routeId,
          otherPortId: toPortId,
        })
        occurrencesByPort[toPortId]!.push({
          regionId,
          routeId,
          otherPortId: fromPortId,
        })
      }
    }

    const groupsByBoundary = new Map<string, BoundaryPortSlot[]>()
    for (let portId = 0; portId < occurrencesByPort.length; portId++) {
      if (this.endpointPortMask[portId] === 1) continue

      const occurrences = occurrencesByPort[portId]!
      const incidentRegionIds = this.topology.incidentPortRegion[portId] ?? []
      if (incidentRegionIds.length !== 2) continue
      const region1Id = Math.min(incidentRegionIds[0]!, incidentRegionIds[1]!)
      const region2Id = Math.max(incidentRegionIds[0]!, incidentRegionIds[1]!)

      let routeId: RouteId | undefined
      let region1OtherPortId: PortId | undefined
      let region2OtherPortId: PortId | undefined
      if (occurrences.length === 0) {
        if (this.state.portAssignment[portId] !== -1) continue
      } else {
        if (occurrences.length !== 2) continue
        routeId = occurrences[0]!.routeId
        if (
          occurrences[1]!.routeId !== routeId ||
          occurrences[0]!.regionId === occurrences[1]!.regionId ||
          !occurrences.some(({ regionId }) => regionId === region1Id) ||
          !occurrences.some(({ regionId }) => regionId === region2Id) ||
          this.state.portAssignment[portId] !== this.problem.routeNet[routeId]
        ) {
          continue
        }
        region1OtherPortId = occurrences.find(
          ({ regionId }) => regionId === region1Id,
        )!.otherPortId
        region2OtherPortId = occurrences.find(
          ({ regionId }) => regionId === region2Id,
        )!.otherPortId
      }

      const boundaryKey = `${region1Id}:${region2Id}`
      const group = groupsByBoundary.get(boundaryKey) ?? []
      group.push({
        portId,
        routeId,
        region1Id,
        region2Id,
        region1OtherPortId,
        region2OtherPortId,
      })
      groupsByBoundary.set(boundaryKey, group)
    }

    return [...groupsByBoundary.values()]
      .map((group) => ({
        slots: group.filter(
          ({ routeId }) =>
            routeId === undefined || this.fixedRouteMask[routeId] === 0,
        ),
        fixedAnchorPortIds: group
          .filter(
            ({ routeId }) =>
              routeId !== undefined && this.fixedRouteMask[routeId] === 1,
          )
          .map(({ portId }) => portId),
      }))
      .filter(
        ({ slots }) =>
          slots.length >= 2 &&
          slots.some(({ routeId }) => routeId !== undefined),
      )
      .map(({ slots, fixedAnchorPortIds }) => ({
        slots: slots.sort((left, right) => left.portId - right.portId),
        fixedAnchorPortIds: fixedAnchorPortIds.sort(
          (left, right) => left - right,
        ),
      }))
  }

  /**
   * A fixed route represents detailed copper that has already been committed.
   * Movable routes may be permuted within the lanes between fixed ports, but
   * may not cross a fixed port's boundary ordering. This preserves the exact
   * topological relation to preloaded copper without disabling optimization in
   * the rest of the graph.
   */
  private preservesFixedBoundaryOrder(
    permutation: BoundaryPermutation,
    fixedAnchorPortIds: readonly PortId[],
  ) {
    if (fixedAnchorPortIds.length === 0) return true
    const { region1Id, region2Id } = permutation.slots[0]!
    const centerDeltaX =
      this.topology.regionCenterX[region2Id]! -
      this.topology.regionCenterX[region1Id]!
    const centerDeltaY =
      this.topology.regionCenterY[region2Id]! -
      this.topology.regionCenterY[region1Id]!
    const projectOntoBoundary = (portId: PortId) =>
      -centerDeltaY * this.topology.portX[portId]! +
      centerDeltaX * this.topology.portY[portId]!

    for (let index = 0; index < permutation.slots.length; index++) {
      const source = permutation.slots[index]!
      if (source.routeId === undefined) continue
      const destinationPortId = permutation.destinationPortIds[index]!
      const sourceProjection = projectOntoBoundary(source.portId)
      const destinationProjection = projectOntoBoundary(destinationPortId)
      for (const fixedPortId of fixedAnchorPortIds) {
        const fixedProjection = projectOntoBoundary(fixedPortId)
        const sourceOffset = sourceProjection - fixedProjection
        const destinationOffset = destinationProjection - fixedProjection
        if (
          (sourceOffset < -COST_EPSILON && destinationOffset > COST_EPSILON) ||
          (sourceOffset > COST_EPSILON && destinationOffset < -COST_EPSILON) ||
          Math.abs(sourceOffset) <= COST_EPSILON !==
            Math.abs(destinationOffset) <= COST_EPSILON
        ) {
          return false
        }
      }
    }
    return true
  }

  private createBoundaryScoringContext(): BoundaryScoringContext {
    const routingRiskByRegion = this.routingRiskByRegion
    const segmentRoutingRiskByRegion = this.segmentRoutingRiskByRegion
    const downstreamRiskByRegion = this.downstreamRiskByRegion
    const rankRegionIds = (values: ArrayLike<number>) =>
      Array.from(
        { length: this.topology.regionCount },
        (_, regionId) => regionId,
      ).sort((left, right) => values[right]! - values[left]! || left - right)
    const getUnaffectedMax = (
      rankedRegionIds: RegionId[],
      values: ArrayLike<number>,
      region1Id: RegionId,
      region2Id: RegionId,
    ) => {
      for (const regionId of rankedRegionIds) {
        if (regionId !== region1Id && regionId !== region2Id) {
          return values[regionId]!
        }
      }
      return 0
    }
    const regionCosts = Float64Array.from(
      this.state.regionIntersectionCaches,
      (cache) => cache.existingRegionCost,
    )
    const rankedRegionIds = rankRegionIds(regionCosts)
    const rankedRoutingRiskRegionIds = rankRegionIds(routingRiskByRegion)
    const rankedSegmentRoutingRiskRegionIds = rankRegionIds(
      segmentRoutingRiskByRegion,
    )
    const rankedDownstreamRiskRegionIds = rankRegionIds(downstreamRiskByRegion)

    return {
      squaredRoutingRiskByRegion: Float64Array.from(
        routingRiskByRegion,
        (routingRisk) => routingRisk * routingRisk,
      ),
      squaredSegmentRoutingRiskByRegion: Float64Array.from(
        segmentRoutingRiskByRegion,
        (routingRisk) => routingRisk * routingRisk,
      ),
      squaredDownstreamRiskByRegion: Float64Array.from(
        downstreamRiskByRegion,
        (downstreamRisk) => downstreamRisk * downstreamRisk,
      ),
      getUnaffectedMaxRegionCost: (region1Id, region2Id) =>
        getUnaffectedMax(rankedRegionIds, regionCosts, region1Id, region2Id),
      getUnaffectedMaxRoutingRisk: (region1Id, region2Id) =>
        getUnaffectedMax(
          rankedRoutingRiskRegionIds,
          routingRiskByRegion,
          region1Id,
          region2Id,
        ),
      getUnaffectedMaxSegmentRoutingRisk: (region1Id, region2Id) =>
        getUnaffectedMax(
          rankedSegmentRoutingRiskRegionIds,
          segmentRoutingRiskByRegion,
          region1Id,
          region2Id,
        ),
      getUnaffectedMaxDownstreamRisk: (region1Id, region2Id) =>
        getUnaffectedMax(
          rankedDownstreamRiskRegionIds,
          downstreamRiskByRegion,
          region1Id,
          region2Id,
        ),
    }
  }

  private scoreBoundaryPermutation(
    permutation: BoundaryPermutation,
    context: BoundaryScoringContext,
    fixedAnchorPortIds: readonly PortId[],
  ): BoundaryMutationScore | undefined {
    if (
      permutation.slots.some(
        ({ routeId }) =>
          routeId !== undefined && this.fixedRouteMask[routeId] === 1,
      )
    ) {
      return
    }
    if (!this.preservesFixedBoundaryOrder(permutation, fixedAnchorPortIds)) {
      this.rejectedFixedBoundaryOrderCount += 1
      return
    }
    const { region1Id, region2Id } = permutation.slots[0]!
    const crossesLayer = permutation.slots.some(
      (source, index) =>
        this.topology.portZ[source.portId] !==
        this.topology.portZ[permutation.destinationPortIds[index]!],
    )
    if (
      this.REGION_COST_MODEL === "routing-complexity" &&
      crossesLayer &&
      !this.preservesRouteLayerChangeCountsAfterPermutation(permutation)
    ) {
      this.rejectedCrossLayerSwapCount += 1
      return
    }
    this.evaluatedMutationCount += 1

    const oldRegion1Cost =
      this.state.regionIntersectionCaches[region1Id]!.existingRegionCost
    const oldRegion2Cost =
      this.state.regionIntersectionCaches[region2Id]!.existingRegionCost
    const region1PrimaryMetrics =
      this.computePrimaryRegionMetricsAfterPermutation(region1Id, permutation)
    const region2PrimaryMetrics =
      this.computePrimaryRegionMetricsAfterPermutation(region2Id, permutation)
    const candidateMaxRegionCost = Math.max(
      context.getUnaffectedMaxRegionCost(region1Id, region2Id),
      region1PrimaryMetrics.regionCost,
      region2PrimaryMetrics.regionCost,
    )
    const candidateTotalRegionCost =
      this.currentSummary.totalRegionCost -
      oldRegion1Cost -
      oldRegion2Cost +
      region1PrimaryMetrics.regionCost +
      region2PrimaryMetrics.regionCost

    // Boundary permutations are cheap, topology-preserving untwists. Their
    // lexicographic primary descent is max cost first and total cost second;
    // allowing the total-cost step clears tied/local tangles that must move
    // before a later permutation can lower the global bottleneck. Whole-route
    // A* remains subject to strict peak reduction below.
    const improvesPrimaryBoundaryObjective =
      candidateMaxRegionCost <
        this.currentSummary.maxRegionCost - COST_EPSILON ||
      (Math.abs(candidateMaxRegionCost - this.currentSummary.maxRegionCost) <=
        COST_EPSILON &&
        candidateTotalRegionCost <
          this.currentSummary.totalRegionCost - COST_EPSILON)
    if (!improvesPrimaryBoundaryObjective) {
      return
    }

    if (this.boundaryPermutationViolatesForeignEndpointKeepout(permutation)) {
      this.rejectedBoundaryEndpointKeepoutCount += 1
      return
    }

    const region1PhysicalRisks = this.computePhysicalRoutingRisksForRegion(
      this,
      region1Id,
      { permutation },
    )
    const region2PhysicalRisks = this.computePhysicalRoutingRisksForRegion(
      this,
      region2Id,
      { permutation },
    )
    const summary = {
      maxRegionCost: candidateMaxRegionCost,
      maxRoutingRisk: Math.max(
        context.getUnaffectedMaxRoutingRisk(region1Id, region2Id),
        region1PhysicalRisks.groupedRisk,
        region2PhysicalRisks.groupedRisk,
      ),
      maxSegmentRoutingRisk: Math.max(
        context.getUnaffectedMaxSegmentRoutingRisk(region1Id, region2Id),
        region1PhysicalRisks.segmentRisk,
        region2PhysicalRisks.segmentRisk,
      ),
      squaredSegmentRoutingRisk:
        this.currentSummary.squaredSegmentRoutingRisk -
        context.squaredSegmentRoutingRiskByRegion[region1Id]! -
        context.squaredSegmentRoutingRiskByRegion[region2Id]! +
        region1PhysicalRisks.segmentRisk ** 2 +
        region2PhysicalRisks.segmentRisk ** 2,
      totalSegmentRoutingRisk:
        this.currentSummary.totalSegmentRoutingRisk -
        this.segmentRoutingRiskByRegion[region1Id]! -
        this.segmentRoutingRiskByRegion[region2Id]! +
        region1PhysicalRisks.segmentRisk +
        region2PhysicalRisks.segmentRisk,
      squaredRoutingRisk:
        this.currentSummary.squaredRoutingRisk -
        context.squaredRoutingRiskByRegion[region1Id]! -
        context.squaredRoutingRiskByRegion[region2Id]! +
        region1PhysicalRisks.groupedRisk ** 2 +
        region2PhysicalRisks.groupedRisk ** 2,
      totalRoutingRisk:
        this.currentSummary.totalRoutingRisk -
        this.routingRiskByRegion[region1Id]! -
        this.routingRiskByRegion[region2Id]! +
        region1PhysicalRisks.groupedRisk +
        region2PhysicalRisks.groupedRisk,
      maxDownstreamRisk: Math.max(
        context.getUnaffectedMaxDownstreamRisk(region1Id, region2Id),
        region1PhysicalRisks.downstreamRisk,
        region2PhysicalRisks.downstreamRisk,
      ),
      squaredDownstreamRisk:
        this.currentSummary.squaredDownstreamRisk -
        context.squaredDownstreamRiskByRegion[region1Id]! -
        context.squaredDownstreamRiskByRegion[region2Id]! +
        region1PhysicalRisks.downstreamRisk ** 2 +
        region2PhysicalRisks.downstreamRisk ** 2,
      totalDownstreamRisk:
        this.currentSummary.totalDownstreamRisk -
        this.downstreamRiskByRegion[region1Id]! -
        this.downstreamRiskByRegion[region2Id]! +
        region1PhysicalRisks.downstreamRisk +
        region2PhysicalRisks.downstreamRisk,
      maxRegionSegmentCount: this.currentSummary.maxRegionSegmentCount,
      squaredRegionSegmentCount: this.currentSummary.squaredRegionSegmentCount,
      totalSegmentLength:
        this.currentSummary.totalSegmentLength -
        this.segmentLengthByRegion[region1Id]! -
        this.segmentLengthByRegion[region2Id]! +
        region1PrimaryMetrics.segmentLength +
        region2PrimaryMetrics.segmentLength,
      totalRegionCost: candidateTotalRegionCost,
    }
    if (!isSwapParetoImprovement(summary, this.currentSummary)) return

    return {
      region1Id,
      region2Id,
      region1Cost: region1PrimaryMetrics.regionCost,
      region2Cost: region2PrimaryMetrics.regionCost,
      region1RoutingRisk: region1PhysicalRisks.groupedRisk,
      region2RoutingRisk: region2PhysicalRisks.groupedRisk,
      region1SegmentRoutingRisk: region1PhysicalRisks.segmentRisk,
      region2SegmentRoutingRisk: region2PhysicalRisks.segmentRisk,
      region1DownstreamRisk: region1PhysicalRisks.downstreamRisk,
      region2DownstreamRisk: region2PhysicalRisks.downstreamRisk,
      region1SegmentLength: region1PrimaryMetrics.segmentLength,
      region2SegmentLength: region2PrimaryMetrics.segmentLength,
      fixedAnchorPortIds: [...fixedAnchorPortIds],
      summary,
    }
  }

  private compareBoundaryMutationKeys(
    left: BoundaryMutation,
    right: BoundaryMutation,
  ) {
    const leftKey = [
      ...left.permutation.slots.map(({ portId }) => portId),
      ...left.permutation.destinationPortIds,
    ]
    const rightKey = [
      ...right.permutation.slots.map(({ portId }) => portId),
      ...right.permutation.destinationPortIds,
    ]
    for (
      let index = 0;
      index < Math.min(leftKey.length, rightKey.length);
      index++
    ) {
      if (leftKey[index] !== rightKey[index]) {
        return leftKey[index]! - rightKey[index]!
      }
    }
    return leftKey.length - rightKey.length
  }

  private selectBetterBoundaryMutation(
    bestMutation: BoundaryMutation | undefined,
    mutation: BoundaryMutation,
  ) {
    if (!bestMutation) return mutation
    const comparison = compareRegionCostSummaries(
      mutation.summary,
      bestMutation.summary,
    )
    return comparison < 0 ||
      (comparison === 0 &&
        this.compareBoundaryMutationKeys(mutation, bestMutation) < 0)
      ? mutation
      : bestMutation
  }

  private findBestSwapMutation(): BoundaryMutation | undefined {
    const context = this.createBoundaryScoringContext()
    let bestMutation: BoundaryMutation | undefined
    for (const group of this.getBoundaryPortGroups()) {
      const { region1Id, region2Id } = group.slots[0]!
      if (
        this.state.regionIntersectionCaches[region1Id]!.existingRegionCost <=
          COST_EPSILON &&
        this.state.regionIntersectionCaches[region2Id]!.existingRegionCost <=
          COST_EPSILON
      ) {
        continue
      }
      for (let leftIndex = 0; leftIndex < group.slots.length; leftIndex++) {
        const left = group.slots[leftIndex]!
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < group.slots.length;
          rightIndex++
        ) {
          const right = group.slots[rightIndex]!
          if (left.routeId === undefined && right.routeId === undefined)
            continue
          if (left.routeId !== undefined && left.routeId === right.routeId) {
            continue
          }
          const permutation: BoundaryPermutation = {
            slots: [left, right],
            destinationPortIds: [right.portId, left.portId],
          }
          const score = this.scoreBoundaryPermutation(
            permutation,
            context,
            group.fixedAnchorPortIds,
          )
          if (!score) continue
          bestMutation = this.selectBetterBoundaryMutation(bestMutation, {
            kind: "swap",
            permutation,
            ...score,
          })
        }
      }
    }
    return bestMutation
  }

  private findBestCycleMutation(): BoundaryMutation | undefined {
    const context = this.createBoundaryScoringContext()
    let bestMutation: BoundaryMutation | undefined
    for (const group of this.getBoundaryPortGroups()) {
      const { region1Id, region2Id } = group.slots[0]!
      if (
        this.state.regionIntersectionCaches[region1Id]!.existingRegionCost <=
          COST_EPSILON &&
        this.state.regionIntersectionCaches[region2Id]!.existingRegionCost <=
          COST_EPSILON
      ) {
        continue
      }
      for (let firstIndex = 0; firstIndex < group.slots.length; firstIndex++) {
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < group.slots.length;
          secondIndex++
        ) {
          for (
            let thirdIndex = secondIndex + 1;
            thirdIndex < group.slots.length;
            thirdIndex++
          ) {
            const slots = [
              group.slots[firstIndex]!,
              group.slots[secondIndex]!,
              group.slots[thirdIndex]!,
            ]
            const routeIds = slots
              .map(({ routeId }) => routeId)
              .filter((routeId): routeId is RouteId => routeId !== undefined)
            if (
              routeIds.length === 0 ||
              new Set(routeIds).size !== routeIds.length
            ) {
              continue
            }
            const destinationOrders = [
              [slots[1]!.portId, slots[2]!.portId, slots[0]!.portId],
              [slots[2]!.portId, slots[0]!.portId, slots[1]!.portId],
            ]
            for (const destinationPortIds of destinationOrders) {
              const permutation: BoundaryPermutation = {
                slots,
                destinationPortIds,
              }
              const score = this.scoreBoundaryPermutation(
                permutation,
                context,
                group.fixedAnchorPortIds,
              )
              if (!score) continue
              bestMutation = this.selectBetterBoundaryMutation(bestMutation, {
                kind: "cycle",
                permutation,
                ...score,
              })
            }
          }
        }
      }
    }
    return bestMutation
  }

  private preservesRouteLayerChangeCountsAfterPermutation(
    permutation: BoundaryPermutation,
  ): boolean {
    for (let index = 0; index < permutation.slots.length; index++) {
      const source = permutation.slots[index]!
      if (source.routeId === undefined) continue
      const destinationPortId = permutation.destinationPortIds[index]!
      const sourceZ = this.topology.portZ[source.portId]!
      const destinationZ = this.topology.portZ[destinationPortId]!
      let currentLayerChangeCount = 0
      let permutedLayerChangeCount = 0
      for (const otherPortId of [
        source.region1OtherPortId,
        source.region2OtherPortId,
      ]) {
        if (otherPortId === undefined) continue
        const otherZ = this.topology.portZ[otherPortId]!
        if (sourceZ !== otherZ) currentLayerChangeCount += 1
        if (destinationZ !== otherZ) permutedLayerChangeCount += 1
      }
      if (currentLayerChangeCount !== permutedLayerChangeCount) return false
    }
    return true
  }

  private boundaryPermutationViolatesForeignEndpointKeepout(
    permutation: BoundaryPermutation,
  ): boolean {
    if (!this.hasForeignEndpointKeepouts) return false
    // A boundary permutation changes chords only in its two incident regions.
    // Validate those chords incrementally; accepted moves recompute the full
    // per-pad clearance vector once in applyBoundaryMutation.
    const affectedRouteIds = new Set(
      permutation.slots.flatMap(({ routeId }) =>
        routeId === undefined ? [] : [routeId],
      ),
    )
    const { region1Id, region2Id } = permutation.slots[0]!
    for (const regionId of [region1Id, region2Id]) {
      for (const [routeId, storedFromPortId, storedToPortId] of this.state
        .regionSegments[regionId]!) {
        if (!affectedRouteIds.has(routeId)) continue
        const fromPortId = this.remapPortForBoundaryPermutation(
          routeId,
          storedFromPortId,
          permutation,
        )
        const toPortId = this.remapPortForBoundaryPermutation(
          routeId,
          storedToPortId,
          permutation,
        )
        if (
          !this.isRouteSegmentAllowedByForeignEndpointKeepouts(
            routeId,
            regionId,
            fromPortId,
            toPortId,
          )
        ) {
          return true
        }
      }
    }
    return false
  }

  private isReplacementSegmentAllowed(
    routeId: RouteId,
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ): boolean {
    if (!this.hasForeignEndpointKeepouts) return true
    const allowed = this.isRouteSegmentAllowedByForeignEndpointKeepouts(
      routeId,
      regionId,
      fromPortId,
      toPortId,
    )
    if (!allowed) {
      this.prunedRerouteEndpointKeepoutSegmentCount += 1
    }
    return allowed
  }

  private getReplacementNeighborPortIds(
    routeId: RouteId,
    regionId: RegionId,
    fromPortId: PortId,
    neighborPortIds: readonly PortId[],
  ): readonly PortId[] {
    const hopKey = fromPortId * this.topology.regionCount + regionId
    let partition = this.terminalKeepoutNeighborPartitionByHop.get(hopKey)
    if (!partition) {
      this.terminalKeepoutNeighborPartitionCacheMissCount += 1
      const constrainedNeighborIndexes: number[] = []
      const constrainedGeometries: CachedTerminalKeepoutGeometry[] = []
      for (let index = 0; index < neighborPortIds.length; index++) {
        const neighborPortId = neighborPortIds[index]!
        if (neighborPortId === fromPortId) continue
        const geometry = this.getTerminalKeepoutGeometry(
          regionId,
          fromPortId,
          neighborPortId,
        )
        if (geometry.violatingKeepoutIndexes.length === 0) continue
        constrainedNeighborIndexes.push(index)
        constrainedGeometries.push(geometry)
      }
      partition = {
        neighborPortIds,
        constrainedNeighborIndexes: Int32Array.from(constrainedNeighborIndexes),
        constrainedGeometries,
      }
      this.terminalKeepoutNeighborPartitionByHop.set(hopKey, partition)
    } else {
      this.terminalKeepoutNeighborPartitionCacheHitCount += 1
    }

    let rejectedNeighborMask: Int8Array | undefined
    for (
      let constrainedIndex = 0;
      constrainedIndex < partition.constrainedNeighborIndexes.length;
      constrainedIndex++
    ) {
      if (
        this.isTerminalKeepoutGeometryAllowed(
          routeId,
          partition.constrainedGeometries[constrainedIndex]!,
        )
      ) {
        continue
      }
      rejectedNeighborMask ??= new Int8Array(neighborPortIds.length)
      rejectedNeighborMask[
        partition.constrainedNeighborIndexes[constrainedIndex]!
      ] = 1
      this.prunedRerouteEndpointKeepoutSegmentCount += 1
    }
    if (!rejectedNeighborMask) return neighborPortIds
    return neighborPortIds.filter(
      (_neighborPortId, index) => rejectedNeighborMask[index] === 0,
    )
  }

  private getCurrentPeakRegionIds(): RegionId[] {
    return this.state.regionIntersectionCaches.flatMap((cache, regionId) =>
      Math.abs(cache.existingRegionCost - this.currentSummary.maxRegionCost) <=
      COST_EPSILON
        ? [regionId]
        : [],
    )
  }

  private findBestRerouteMutation(
    swapIncumbentSummary?: UnravelRegionCostSummary,
  ): RerouteMutation | undefined {
    if (
      this.MAX_HOT_REGIONS === 0 ||
      this.MAX_REROUTE_ROUTES === 0 ||
      this.REROUTE_CONGESTION_FACTORS.length === 0
    ) {
      return
    }

    // Whole-route replacement is the expensive, topology-changing part of the
    // optimizer. Use it only where removing a route can lower the current peak;
    // total-cost plateaus are optimized by the exhaustive topology-preserving
    // boundary neighborhood. This is an objective-derived decomposition, not
    // a graph-size or sample-dependent eligibility threshold.
    const candidateRegionIds = Array.from(
      { length: this.topology.regionCount },
      (_, regionId) => regionId,
    )
      .filter(
        (regionId) =>
          this.state.regionIntersectionCaches[regionId]!.existingRegionCost >
          COST_EPSILON,
      )
      .sort(
        (left, right) =>
          this.state.regionIntersectionCaches[right]!.existingRegionCost -
            this.state.regionIntersectionCaches[left]!.existingRegionCost ||
          left - right,
      )
      .slice(0, this.MAX_HOT_REGIONS)
    const routeIds = [
      ...new Set(
        candidateRegionIds.flatMap((regionId) =>
          this.state.regionSegments[regionId]!.map(([routeId]) => routeId),
        ),
      ),
    ].filter((routeId) => this.fixedRouteMask[routeId] === 0)
    const routeCandidates = routeIds
      .map((routeId) => ({
        routeId,
        optimisticSummary: this.summarizeStateWithoutRoute(routeId),
      }))
      .filter(
        ({ optimisticSummary }) =>
          optimisticSummary.maxRegionCost <
          this.currentSummary.maxRegionCost - COST_EPSILON,
      )
      .sort(
        (left, right) =>
          compareRegionCostSummaries(
            left.optimisticSummary,
            right.optimisticSummary,
          ) || left.routeId - right.routeId,
      )
      .slice(0, this.MAX_REROUTE_ROUTES)

    const candidateSolver = (this.routeReplacementSolver ??=
      new SingleRouteReplacementSolver(
        this,
        this.REROUTE_MAX_ITERATIONS,
        this.hasForeignEndpointKeepouts
          ? (routeId, regionId, fromPortId, toPortId) =>
              this.isReplacementSegmentAllowed(
                routeId,
                regionId,
                fromPortId,
                toPortId,
              )
          : undefined,
        this.hasForeignEndpointKeepouts
          ? (routeId, regionId, fromPortId, neighborPortIds) =>
              this.getReplacementNeighborPortIds(
                routeId,
                regionId,
                fromPortId,
                neighborPortIds,
              )
          : undefined,
      ))
    type ScoredRerouteCandidate = {
      mutation?: RerouteMutation
      reusable: boolean
    }
    const scorePreparedCandidate = (
      routeId: RouteId,
      congestionFactor: number,
      replacementPath: ReplacementPathSegment[],
    ): ScoredRerouteCandidate => {
      this.evaluatedMutationCount += 1
      if (!candidateSolver.solved || candidateSolver.failed) {
        return { reusable: false }
      }

      const candidateRouteSegmentCount =
        candidateSolver.replacementRouteSegmentCount
      if (
        candidateRouteSegmentCount >
        this.initialRouteSegmentCounts[routeId]! +
          this.MAX_REROUTE_SEGMENT_INCREASE
      ) {
        this.rejectedRerouteDetourCount += 1
        return { reusable: false }
      }

      // A post-solve optimization may relocate an existing transition, but it
      // must not introduce additional transitions into an already valid route.
      // Extra transitions become extra vias in the detailed router and can
      // create pad/obstacle clearance failures outside the rerouted regions.
      if (
        candidateSolver.replacementRouteLayerChangeCountByRouteId[routeId]! >
        this.routeLayerChangeCountByRouteId[routeId]!
      ) {
        this.rejectedRerouteLayerChangeCount += 1
        return { reusable: false }
      }

      const endpointKeepout = this.replacementViolatesForeignEndpointKeepout(
        candidateSolver,
        [routeId],
      )
      if (endpointKeepout.violates) {
        this.rejectedRerouteEndpointKeepoutCount += 1
        return { reusable: true }
      }

      candidateSolver.rescoreForOptimizer(this)
      const scoredState = this.summarizeReplacementSolverState(candidateSolver)
      const { summary } = scoredState
      if (
        !isRoutingRiskNoWorse(summary, this.currentSummary, this.initialSummary)
      ) {
        this.rejectedReroutePhysicalRiskCount += 1
        return { reusable: true }
      }
      if (!isRerouteParetoImprovement(summary, this.currentSummary)) {
        return { reusable: true }
      }

      return {
        reusable: true,
        mutation: {
          kind: "reroute",
          routeId,
          routeIds: [routeId],
          congestionFactor,
          replacementPath,
          replacementState: candidateSolver.getReplacementState(),
          replacementRouteMetrics: [
            {
              routeId,
              layerChangeCount:
                candidateSolver.replacementRouteLayerChangeCountByRouteId[
                  routeId
                ]!,
              segmentLength:
                candidateSolver.replacementRouteSegmentLengthByRouteId[
                  routeId
                ]!,
              foreignEndpointClearances: endpointKeepout.clearances[0]!,
            },
          ],
          routingRiskByRegion: scoredState.routingRiskByRegion,
          segmentRoutingRiskByRegion: scoredState.segmentRoutingRiskByRegion,
          downstreamRiskByRegion: scoredState.downstreamRiskByRegion,
          segmentLengthByRegion: scoredState.segmentLengthByRegion,
          summary,
        },
      }
    }
    const evaluateRoute = (
      routeId: RouteId,
      congestionFactor: number,
    ): ScoredRerouteCandidate => {
      candidateSolver.resetForRoute(this, routeId, congestionFactor)
      candidateSolver.solve()
      this.rerouteSearchCount += 1
      this.rerouteSearchIterationCount += candidateSolver.iterations
      this.singleRerouteSearchCount += 1
      this.singleRerouteSearchIterationCount += candidateSolver.iterations
      if (!candidateSolver.solved || candidateSolver.failed) {
        this.singleRerouteFailedSearchCount += 1
        this.singleRerouteFailedSearchIterationCount +=
          candidateSolver.iterations
      }
      const replacementPath =
        candidateSolver.solved && !candidateSolver.failed
          ? candidateSolver.getReplacementPath(routeId)
          : []
      this.rerouteBlockingRouteIdsByRouteId.set(
        routeId,
        [...candidateSolver.blockingRouteIds].sort(
          (left, right) => left - right,
        ),
      )
      if (!candidateSolver.solved || candidateSolver.failed) {
        this.evaluatedMutationCount += 1
        return { reusable: false }
      }
      return scorePreparedCandidate(routeId, congestionFactor, replacementPath)
    }
    const selectBetterReroute = (
      bestMutation: RerouteMutation | undefined,
      mutation: RerouteMutation | undefined,
    ) => {
      if (!mutation) return bestMutation
      if (!bestMutation) return mutation
      const comparison = compareRegionCostSummaries(
        mutation.summary,
        bestMutation.summary,
      )
      return comparison < 0 ||
        (comparison === 0 &&
          (mutation.routeId < bestMutation.routeId ||
            (mutation.routeId === bestMutation.routeId &&
              mutation.congestionFactor < bestMutation.congestionFactor)))
        ? mutation
        : bestMutation
    }

    const getReroutePathKey = ({
      routeId,
      congestionFactor,
    }: CachedReroutePath) => `${routeId}:${congestionFactor}`
    const retainUnselectedPaths = (
      reusablePaths: Iterable<CachedReroutePath>,
      selectedMutation: RerouteMutation | undefined,
    ) => {
      this.pendingReroutePaths = selectedMutation
        ? [...reusablePaths].filter(
            ({ routeId, congestionFactor }) =>
              routeId !== selectedMutation.routeId ||
              congestionFactor !== selectedMutation.congestionFactor,
          )
        : [...reusablePaths]
    }

    // A full route sweep solves many valid paths but can apply only one.
    // Revalidate those exact paths against the new state before launching A*
    // again. Port ownership validation plus full objective rescoring make reuse
    // exact; when the cache is exhausted, the fresh sweep below still provides
    // the local-optimum proof.
    if (this.pendingReroutePaths.length > 0) {
      const pendingPaths = this.pendingReroutePaths
      this.pendingReroutePaths = []
      const reusablePathByKey = new Map<string, CachedReroutePath>()
      let bestCachedMutation: RerouteMutation | undefined
      for (const cachedPath of pendingPaths) {
        if (
          !candidateSolver.loadReplacementPath(
            this,
            cachedPath.routeId,
            cachedPath.congestionFactor,
            cachedPath.replacementPath,
          )
        ) {
          continue
        }
        this.reusedRerouteCandidateCount += 1
        const scoredCandidate = scorePreparedCandidate(
          cachedPath.routeId,
          cachedPath.congestionFactor,
          cachedPath.replacementPath,
        )
        if (scoredCandidate.reusable) {
          reusablePathByKey.set(getReroutePathKey(cachedPath), cachedPath)
        }
        const mutation = scoredCandidate.mutation
        if (!mutation) continue
        if (
          swapIncumbentSummary &&
          compareRegionCostSummaries(mutation.summary, swapIncumbentSummary) >=
            0
        ) {
          continue
        }
        bestCachedMutation = selectBetterReroute(bestCachedMutation, mutation)
      }
      if (bestCachedMutation) {
        retainUnselectedPaths(reusablePathByKey.values(), bestCachedMutation)
        return bestCachedMutation
      }

      // Preserve valid cached paths through the fresh sweep. A newly searched
      // path for the same route replaces the older snapshot in the map.
      this.pendingReroutePaths = [...reusablePathByKey.values()]
    }

    this.rerouteBlockingRouteIdsByRouteId.clear()
    let bestMutation: RerouteMutation | undefined
    const reusablePathByKey = new Map(
      this.pendingReroutePaths.map((path) => [getReroutePathKey(path), path]),
    )
    this.pendingReroutePaths = []
    for (
      let candidateIndex = 0;
      candidateIndex < routeCandidates.length;
      candidateIndex++
    ) {
      const { routeId, optimisticSummary } = routeCandidates[candidateIndex]!
      if (
        compareRegionCostSummaries(optimisticSummary, this.currentSummary) >= 0
      ) {
        this.prunedRerouteSearchCount +=
          (routeCandidates.length - candidateIndex) *
          this.REROUTE_CONGESTION_FACTORS.length
        break
      }
      if (
        swapIncumbentSummary &&
        compareRegionCostSummaries(optimisticSummary, swapIncumbentSummary) >= 0
      ) {
        this.prunedRerouteSearchCount +=
          (routeCandidates.length - candidateIndex) *
          this.REROUTE_CONGESTION_FACTORS.length
        break
      }
      if (bestMutation) {
        const boundComparison = compareRegionCostSummaries(
          optimisticSummary,
          bestMutation.summary,
        )
        if (
          boundComparison > 0 ||
          (boundComparison === 0 && routeId > bestMutation.routeId)
        ) {
          this.prunedRerouteSearchCount +=
            (routeCandidates.length - candidateIndex) *
            this.REROUTE_CONGESTION_FACTORS.length
          break
        }
      }
      for (const congestionFactor of this.REROUTE_CONGESTION_FACTORS) {
        const scoredCandidate = evaluateRoute(routeId, congestionFactor)
        const mutation = scoredCandidate.mutation
        if (scoredCandidate.reusable) {
          const reusablePath: CachedReroutePath = {
            routeId,
            congestionFactor,
            replacementPath:
              mutation?.replacementPath ??
              candidateSolver.getReplacementPath(routeId),
          }
          reusablePathByKey.set(getReroutePathKey(reusablePath), reusablePath)
        }
        if (!mutation) continue
        if (
          swapIncumbentSummary &&
          compareRegionCostSummaries(mutation.summary, swapIncumbentSummary) >=
            0
        ) {
          continue
        }
        bestMutation = selectBetterReroute(bestMutation, mutation)
      }
    }

    retainUnselectedPaths(reusablePathByKey.values(), bestMutation)
    return bestMutation
  }

  /**
   * Large-neighborhood repair for a one-route local optimum. Any strict peak
   * reduction must change a route using a peak-cost region. Pair it only with
   * reserved-port owners measured by A*, plus routes required to cover another
   * tied peak. Merely sharing a corridor is a cost interaction already scored
   * by the single-route search, not an ejection dependency. Remove the pair
   * atomically and solve both deterministic route orders against the fixed
   * remainder.
   */
  private findBestPairRerouteMutation(
    incumbentSummary?: UnravelRegionCostSummary,
  ): RerouteMutation | undefined {
    // There is no strict region-cost improvement below the zero floor. In
    // particular, treating every zero-cost region as a tied peak would turn a
    // solved bottleneck into a needless whole-graph pair search.
    if (this.currentSummary.maxRegionCost <= COST_EPSILON) return

    const peakRegionIds = this.state.regionIntersectionCaches.flatMap(
      (cache, regionId) =>
        Math.abs(
          cache.existingRegionCost - this.currentSummary.maxRegionCost,
        ) <= COST_EPSILON
          ? [regionId]
          : [],
    )
    const peakRouteIds = [
      ...new Set(
        peakRegionIds.flatMap((regionId) =>
          this.state.regionSegments[regionId]!.map(([routeId]) => routeId),
        ),
      ),
    ]
      .filter((routeId) => this.fixedRouteMask[routeId] === 0)
      .sort((left, right) => left - right)
    if (peakRouteIds.length === 0) return
    const routeTouchesRegion = (routeId: RouteId, regionId: RegionId) =>
      this.state.regionSegments[regionId]!.some(
        ([segmentRouteId]) => segmentRouteId === routeId,
      )
    const interactingRouteIdsByRouteId = new Map<RouteId, Set<RouteId>>()
    const addInteraction = (leftRouteId: RouteId, rightRouteId: RouteId) => {
      if (leftRouteId === rightRouteId) return
      const leftInteractions =
        interactingRouteIdsByRouteId.get(leftRouteId) ?? new Set<RouteId>()
      const rightInteractions =
        interactingRouteIdsByRouteId.get(rightRouteId) ?? new Set<RouteId>()
      leftInteractions.add(rightRouteId)
      rightInteractions.add(leftRouteId)
      interactingRouteIdsByRouteId.set(leftRouteId, leftInteractions)
      interactingRouteIdsByRouteId.set(rightRouteId, rightInteractions)
    }
    for (const regionId of peakRegionIds) {
      const chords: Array<{
        routeId: RouteId
        ownerId: number
        lesserAngle: number
        greaterAngle: number
        layerMask: number
      }> = []
      const seenOwnerIds = new Set<number>()
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        const ownerId = this.getIntersectionOwnerId(routeId)
        if (
          this.REGION_COST_MODEL === "routing-risk" &&
          seenOwnerIds.has(ownerId)
        ) {
          continue
        }
        seenOwnerIds.add(ownerId)
        const geometry = this.populateSegmentGeometryScratch(
          regionId,
          fromPortId,
          toPortId,
        )
        chords.push({
          routeId,
          ownerId,
          lesserAngle: geometry.lesserAngle,
          greaterAngle: geometry.greaterAngle,
          layerMask: geometry.layerMask,
        })
      }
      for (let leftIndex = 0; leftIndex < chords.length; leftIndex++) {
        const left = chords[leftIndex]!
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < chords.length;
          rightIndex++
        ) {
          const right = chords[rightIndex]!
          if (left.ownerId === right.ownerId) continue
          if (
            this.REGION_COST_MODEL === "routing-risk" &&
            (left.lesserAngle === right.lesserAngle ||
              left.lesserAngle === right.greaterAngle ||
              left.greaterAngle === right.lesserAngle ||
              left.greaterAngle === right.greaterAngle)
          ) {
            continue
          }
          const intersects =
            (right.lesserAngle < left.lesserAngle &&
              left.lesserAngle < right.greaterAngle) !==
            (right.lesserAngle < left.greaterAngle &&
              left.greaterAngle < right.greaterAngle)
          if (
            !intersects ||
            !classifyIntersectionLayerMasks(
              left.layerMask,
              right.layerMask,
              this.REGION_COST_MODEL,
            )
          ) {
            continue
          }
          addInteraction(left.routeId, right.routeId)
        }
      }
    }
    const pairKeys = new Set<string>()
    const routePairs: Array<[RouteId, RouteId]> = []
    for (const peakRouteId of peakRouteIds) {
      const blockingRouteIds = new Set([
        ...(this.rerouteBlockingRouteIdsByRouteId.get(peakRouteId) ?? []),
        ...(interactingRouteIdsByRouteId.get(peakRouteId) ?? []),
      ])

      // A second peak route is relevant only when the first route does not
      // touch that tied peak. Avoiding an all-peak clique keeps the pair stage
      // on a causal ejection frontier instead of a quadratic portfolio.
      for (const otherPeakRouteId of peakRouteIds) {
        if (
          otherPeakRouteId !== peakRouteId &&
          peakRegionIds.some(
            (regionId) =>
              !routeTouchesRegion(peakRouteId, regionId) &&
              routeTouchesRegion(otherPeakRouteId, regionId),
          )
        ) {
          blockingRouteIds.add(otherPeakRouteId)
        }
      }
      for (const [routeId, dependencies] of this
        .rerouteBlockingRouteIdsByRouteId) {
        if (dependencies.includes(peakRouteId)) blockingRouteIds.add(routeId)
      }
      for (const otherRouteId of blockingRouteIds) {
        if (
          otherRouteId === peakRouteId ||
          this.fixedRouteMask[otherRouteId] === 1
        ) {
          continue
        }
        const leftRouteId = Math.min(peakRouteId, otherRouteId)
        const rightRouteId = Math.max(peakRouteId, otherRouteId)
        // Re-adding routes cannot reduce an untouched peak. This is an exact
        // admissible test for the pair stage's strict peak-reduction purpose.
        if (
          peakRegionIds.some(
            (regionId) =>
              !routeTouchesRegion(leftRouteId, regionId) &&
              !routeTouchesRegion(rightRouteId, regionId),
          )
        ) {
          continue
        }
        const key = `${leftRouteId}:${rightRouteId}`
        if (pairKeys.has(key)) continue
        pairKeys.add(key)
        routePairs.push([leftRouteId, rightRouteId])
      }
    }
    routePairs.sort((left, right) => left[0] - right[0] || left[1] - right[1])
    return this.findBestMultiRouteRerouteMutation(routePairs, incumbentSummary)
  }

  private getRouteSolveOrders(routeIds: RouteId[]): RouteId[][] {
    if (routeIds.length <= 1) return [[...routeIds]]
    const orders: RouteId[][] = []
    for (let index = 0; index < routeIds.length; index++) {
      const routeId = routeIds[index]!
      const remainder = [
        ...routeIds.slice(0, index),
        ...routeIds.slice(index + 1),
      ]
      for (const suffix of this.getRouteSolveOrders(remainder)) {
        orders.push([routeId, ...suffix])
      }
    }
    return orders
  }

  private compareRouteIdLists(left: RouteId[], right: RouteId[]) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) return left[index]! - right[index]!
    }
    return left.length - right.length
  }

  private findBestMultiRouteRerouteMutation(
    routeSets: RouteId[][],
    incumbentSummary?: UnravelRegionCostSummary,
  ): RerouteMutation | undefined {
    const routeSetCandidates = routeSets
      .map((routeIds) => ({
        routeIds,
        optimisticSummary: this.summarizeStateWithoutRoutes(routeIds),
      }))
      .sort(
        (left, right) =>
          compareRegionCostSummaries(
            left.optimisticSummary,
            right.optimisticSummary,
          ) || this.compareRouteIdLists(left.routeIds, right.routeIds),
      )

    const candidateSolver = (this.routeReplacementSolver ??=
      new SingleRouteReplacementSolver(
        this,
        this.REROUTE_MAX_ITERATIONS,
        this.hasForeignEndpointKeepouts
          ? (routeId, regionId, fromPortId, toPortId) =>
              this.isReplacementSegmentAllowed(
                routeId,
                regionId,
                fromPortId,
                toPortId,
              )
          : undefined,
        this.hasForeignEndpointKeepouts
          ? (routeId, regionId, fromPortId, neighborPortIds) =>
              this.getReplacementNeighborPortIds(
                routeId,
                regionId,
                fromPortId,
                neighborPortIds,
              )
          : undefined,
      ))
    let bestMutation: RerouteMutation | undefined

    const selectBetterMutation = (mutation: RerouteMutation) => {
      if (!bestMutation) {
        bestMutation = mutation
        return
      }
      const comparison = compareRegionCostSummaries(
        mutation.summary,
        bestMutation.summary,
      )
      if (
        comparison < 0 ||
        (comparison === 0 &&
          this.compareRouteIdLists(mutation.routeIds, bestMutation.routeIds) <
            0)
      ) {
        bestMutation = mutation
      }
    }

    const scoreSolvedCandidate = (
      routeIds: RouteId[],
      solveOrder: RouteId[],
    ) => {
      this.evaluatedMutationCount += 1
      if (!candidateSolver.solved || candidateSolver.failed) return

      for (const routeId of solveOrder) {
        if (
          candidateSolver.replacementRouteSegmentCountByRouteId[routeId]! >
          this.initialRouteSegmentCounts[routeId]! +
            this.MAX_REROUTE_SEGMENT_INCREASE
        ) {
          this.rejectedRerouteDetourCount += 1
          return
        }
        if (
          candidateSolver.replacementRouteLayerChangeCountByRouteId[routeId]! >
          this.routeLayerChangeCountByRouteId[routeId]!
        ) {
          this.rejectedRerouteLayerChangeCount += 1
          return
        }
      }

      const endpointKeepout = this.replacementViolatesForeignEndpointKeepout(
        candidateSolver,
        solveOrder,
      )
      if (endpointKeepout.violates) {
        this.rejectedRerouteEndpointKeepoutCount += 1
        return
      }

      candidateSolver.rescoreForOptimizer(this)
      const scoredState = this.summarizeReplacementSolverState(candidateSolver)
      const { summary } = scoredState
      if (
        !isRoutingRiskNoWorse(summary, this.currentSummary, this.initialSummary)
      ) {
        this.rejectedReroutePhysicalRiskCount += 1
        return
      }
      if (!isRerouteParetoImprovement(summary, this.currentSummary)) return
      if (
        incumbentSummary &&
        compareRegionCostSummaries(summary, incumbentSummary) >= 0
      ) {
        return
      }

      selectBetterMutation({
        kind: "reroute",
        routeId: Math.min(...routeIds),
        routeIds: [...solveOrder],
        congestionFactor: 0,
        replacementPath: [],
        replacementState: candidateSolver.getReplacementState(),
        replacementRouteMetrics: solveOrder.map((routeId, routeIndex) => ({
          routeId,
          layerChangeCount:
            candidateSolver.replacementRouteLayerChangeCountByRouteId[routeId]!,
          segmentLength:
            candidateSolver.replacementRouteSegmentLengthByRouteId[routeId]!,
          foreignEndpointClearances: endpointKeepout.clearances[routeIndex]!,
        })),
        routingRiskByRegion: scoredState.routingRiskByRegion,
        segmentRoutingRiskByRegion: scoredState.segmentRoutingRiskByRegion,
        downstreamRiskByRegion: scoredState.downstreamRiskByRegion,
        segmentLengthByRegion: scoredState.segmentLengthByRegion,
        summary,
      })
    }

    for (
      let candidateIndex = 0;
      candidateIndex < routeSetCandidates.length;
      candidateIndex++
    ) {
      const { routeIds, optimisticSummary } =
        routeSetCandidates[candidateIndex]!
      const solveOrders = this.getRouteSolveOrders(routeIds)
      if (
        optimisticSummary.maxRegionCost >=
        this.currentSummary.maxRegionCost - COST_EPSILON
      ) {
        this.prunedRerouteSearchCount +=
          (routeSetCandidates.length - candidateIndex) * solveOrders.length
        break
      }
      if (
        compareRegionCostSummaries(
          optimisticSummary,
          bestMutation?.summary ?? incumbentSummary ?? this.currentSummary,
        ) >= 0
      ) {
        this.prunedRerouteSearchCount +=
          (routeSetCandidates.length - candidateIndex) * solveOrders.length
        break
      }
      for (const solveOrder of solveOrders) {
        candidateSolver.resetForRoutes(this, solveOrder, 0)
        candidateSolver.solve()
        this.rerouteSearchCount += 1
        this.rerouteSearchIterationCount += candidateSolver.iterations
        this.pairRerouteSearchCount += 1
        this.pairRerouteSearchIterationCount += candidateSolver.iterations
        if (!candidateSolver.solved || candidateSolver.failed) {
          this.pairRerouteFailedSearchCount += 1
          this.pairRerouteFailedSearchIterationCount +=
            candidateSolver.iterations
        }
        scoreSolvedCandidate(routeIds, solveOrder)
      }
    }
    return bestMutation
  }

  private computeSegmentLength(
    solver: TinyHyperGraphSolver,
    fromPortId: PortId,
    toPortId: PortId,
  ): number {
    return Math.hypot(
      solver.topology.portX[toPortId]! - solver.topology.portX[fromPortId]!,
      solver.topology.portY[toPortId]! - solver.topology.portY[fromPortId]!,
    )
  }

  private queryTerminalKeepoutIndexes(
    regionId: RegionId,
    startX: number,
    startY: number,
    startZ: number,
    endX: number,
    endY: number,
    endZ: number,
  ): number[] {
    if (!this.hasForeignEndpointKeepouts) return []
    this.terminalKeepoutBroadPhaseQueryCount += 1
    const regionKeepoutIndexes = this.terminalKeepoutIndexesByRegion[regionId]!
    this.terminalKeepoutBroadPhaseCandidateCount += regionKeepoutIndexes.length
    const isLayerChange = startZ !== endZ
    const keepoutIndexes: number[] = []
    for (const keepoutIndex of regionKeepoutIndexes) {
      const keepout = this.terminalKeepouts[keepoutIndex]!
      if (
        (!isLayerChange && keepout.z !== startZ) ||
        (isLayerChange &&
          (keepout.z < Math.min(startZ, endZ) ||
            keepout.z > Math.max(startZ, endZ)))
      ) {
        continue
      }
      const clearance = isLayerChange
        ? (keepout.viaCenterClearance ?? keepout.traceCenterClearance)
        : keepout.traceCenterClearance

      // Exact violations are necessarily contained by this conservative
      // square-envelope test. Rejecting the overwhelmingly common diagonal
      // misses here avoids allocating and evaluating Euclidean pad geometry,
      // while the exact rounded-corner distance remains the acceptance test.
      if (
        segmentIntersectsAxisAlignedBounds(
          startX,
          startY,
          endX,
          endY,
          keepout.minX - clearance,
          keepout.minY - clearance,
          keepout.maxX + clearance,
          keepout.maxY + clearance,
        )
      ) {
        keepoutIndexes.push(keepoutIndex)
      }
    }
    return keepoutIndexes
  }

  private getRegionPortIndex(regionId: RegionId, portId: PortId): number {
    const incidentRegionIds = this.topology.incidentPortRegion[portId]!
    if (incidentRegionIds[0] === regionId) {
      return this.firstIncidentRegionPortIndex[portId]!
    }
    if (incidentRegionIds[1] === regionId) {
      return this.secondIncidentRegionPortIndex[portId]!
    }
    const portIndex = this.overflowIncidentRegionPortIndex.get(
      portId * this.topology.regionCount + regionId,
    )
    if (portIndex === undefined) {
      throw new Error(`Port ${portId} is not incident to region ${regionId}`)
    }
    return portIndex
  }

  private getTerminalKeepoutGeometry(
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ): CachedTerminalKeepoutGeometry {
    const regionPortCount = this.topology.regionIncidentPorts[regionId]!.length
    const fromPortIndex = this.getRegionPortIndex(regionId, fromPortId)
    const toPortIndex = this.getRegionPortIndex(regionId, toPortId)
    const geometryIndexByPortPair =
      this.terminalKeepoutGeometryIndexByRegion[regionId]!
    const geometrySlot = fromPortIndex * regionPortCount + toPortIndex
    const cachedGeometryIndex = geometryIndexByPortPair[geometrySlot]!
    if (cachedGeometryIndex === EMPTY_TERMINAL_KEEPOUT_GEOMETRY_INDEX) {
      this.terminalKeepoutGeometryCacheHitCount += 1
      return EMPTY_TERMINAL_KEEPOUT_GEOMETRY
    }
    if (cachedGeometryIndex >= 0) {
      this.terminalKeepoutGeometryCacheHitCount += 1
      return this.terminalKeepoutGeometries[cachedGeometryIndex]!
    }

    const startX = this.topology.portX[fromPortId]!
    const startY = this.topology.portY[fromPortId]!
    const startZ = this.topology.portZ[fromPortId]!
    const endX = this.topology.portX[toPortId]!
    const endY = this.topology.portY[toPortId]!
    const endZ = this.topology.portZ[toPortId]!
    const keepoutIndexes = this.queryTerminalKeepoutIndexes(
      regionId,
      startX,
      startY,
      startZ,
      endX,
      endY,
      endZ,
    )
    const violatingKeepoutIndexes: number[] = []
    const violatingClearances: number[] = []
    for (const keepoutIndex of keepoutIndexes) {
      const keepout = this.terminalKeepouts[keepoutIndex]!
      this.terminalKeepoutExactCheckCount += 1
      const clearance = getSegmentToTerminalKeepoutClearance({
        startX,
        startY,
        startZ,
        endX,
        endY,
        endZ,
        keepout,
      })
      if (clearance < 0) {
        violatingKeepoutIndexes.push(keepoutIndex)
        violatingClearances.push(clearance)
      }
    }
    const reverseGeometrySlot = toPortIndex * regionPortCount + fromPortIndex
    if (violatingKeepoutIndexes.length === 0) {
      geometryIndexByPortPair[geometrySlot] =
        EMPTY_TERMINAL_KEEPOUT_GEOMETRY_INDEX
      geometryIndexByPortPair[reverseGeometrySlot] =
        EMPTY_TERMINAL_KEEPOUT_GEOMETRY_INDEX
      return EMPTY_TERMINAL_KEEPOUT_GEOMETRY
    }
    const geometry = {
      violatingKeepoutIndexes: Int32Array.from(violatingKeepoutIndexes),
      violatingClearances: Float64Array.from(violatingClearances),
    }
    const geometryIndex = this.terminalKeepoutGeometries.length
    this.terminalKeepoutGeometries.push(geometry)
    geometryIndexByPortPair[geometrySlot] = geometryIndex
    geometryIndexByPortPair[reverseGeometrySlot] = geometryIndex
    return geometry
  }

  private computeRouteForeignEndpointClearances(
    solver: TinyHyperGraphSolver,
    routeId: RouteId,
    permutation?: BoundaryPermutation,
  ): Float64Array {
    const clearances = new Float64Array(this.terminalKeepouts.length)
    clearances.fill(Number.POSITIVE_INFINITY)
    if (!this.hasForeignEndpointKeepouts) return clearances
    const routeNetId = this.problem.routeNet[routeId]!
    for (
      let regionId = 0;
      regionId < solver.state.regionSegments.length;
      regionId++
    ) {
      for (const [segmentRouteId, storedFromPortId, storedToPortId] of solver
        .state.regionSegments[regionId]!) {
        if (segmentRouteId !== routeId) continue
        const fromPortId = permutation
          ? this.remapPortForBoundaryPermutation(
              routeId,
              storedFromPortId,
              permutation,
            )
          : storedFromPortId
        const toPortId = permutation
          ? this.remapPortForBoundaryPermutation(
              routeId,
              storedToPortId,
              permutation,
            )
          : storedToPortId
        const geometry = this.getTerminalKeepoutGeometry(
          regionId,
          fromPortId,
          toPortId,
        )
        for (
          let geometryIndex = 0;
          geometryIndex < geometry.violatingKeepoutIndexes.length;
          geometryIndex++
        ) {
          const keepoutIndex = geometry.violatingKeepoutIndexes[geometryIndex]!
          const keepout = this.terminalKeepouts[keepoutIndex]!
          if (keepout.netId === routeNetId) continue
          clearances[keepoutIndex] = Math.min(
            clearances[keepoutIndex]!,
            geometry.violatingClearances[geometryIndex]!,
          )
        }
      }
    }
    return clearances
  }

  private isRouteSegmentAllowedByForeignEndpointKeepouts(
    routeId: RouteId,
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ): boolean {
    if (!this.hasForeignEndpointKeepouts) return true
    const geometry = this.getTerminalKeepoutGeometry(
      regionId,
      fromPortId,
      toPortId,
    )
    return this.isTerminalKeepoutGeometryAllowed(routeId, geometry)
  }

  private isTerminalKeepoutGeometryAllowed(
    routeId: RouteId,
    geometry: CachedTerminalKeepoutGeometry,
  ): boolean {
    const baselineClearances =
      this.routeForeignEndpointClearancesByRouteId[routeId]!
    const routeNetId = this.problem.routeNet[routeId]!
    for (
      let geometryIndex = 0;
      geometryIndex < geometry.violatingKeepoutIndexes.length;
      geometryIndex++
    ) {
      const keepoutIndex = geometry.violatingKeepoutIndexes[geometryIndex]!
      const keepout = this.terminalKeepouts[keepoutIndex]!
      if (keepout.netId === routeNetId) continue
      const clearance = geometry.violatingClearances[geometryIndex]!
      if (
        clearance + COST_EPSILON <
        Math.min(0, baselineClearances[keepoutIndex]!)
      ) {
        return false
      }
    }
    return true
  }

  private getMinimumForeignEndpointClearance(): number {
    let minimumClearance = Number.POSITIVE_INFINITY
    for (const routeClearances of this
      .routeForeignEndpointClearancesByRouteId) {
      for (const clearance of routeClearances) {
        minimumClearance = Math.min(minimumClearance, clearance)
      }
    }
    return minimumClearance
  }

  private replacementViolatesForeignEndpointKeepout(
    solver: TinyHyperGraphSolver,
    routeIds: readonly RouteId[],
    permutation?: BoundaryPermutation,
  ): { violates: boolean; clearances: Float64Array[] } {
    const clearances = routeIds.map((routeId) =>
      this.computeRouteForeignEndpointClearances(solver, routeId, permutation),
    )
    return {
      violates: routeIds.some((routeId, routeIndex) => {
        const candidateClearances = clearances[routeIndex]!
        const currentClearances =
          this.routeForeignEndpointClearancesByRouteId[routeId]!
        for (
          let keepoutIndex = 0;
          keepoutIndex < candidateClearances.length;
          keepoutIndex++
        ) {
          if (
            candidateClearances[keepoutIndex]! + COST_EPSILON <
            Math.min(0, currentClearances[keepoutIndex]!)
          ) {
            return true
          }
        }
        return false
      }),
      clearances,
    }
  }

  private recomputeRouteMetrics(routeIds: readonly RouteId[]) {
    const routeIdSet = new Set(routeIds)
    for (const routeId of routeIdSet) {
      this.routeLayerChangeCountByRouteId[routeId] = 0
      this.routeSegmentLengthByRouteId[routeId] = 0
    }
    for (const segments of this.state.regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments) {
        if (!routeIdSet.has(routeId)) continue
        if (this.topology.portZ[fromPortId] !== this.topology.portZ[toPortId]) {
          this.routeLayerChangeCountByRouteId[routeId] += 1
        }
        this.routeSegmentLengthByRouteId[routeId] += this.computeSegmentLength(
          this,
          fromPortId,
          toPortId,
        )
      }
    }
    for (const routeId of routeIdSet) {
      this.routeForeignEndpointClearancesByRouteId[routeId] =
        this.computeRouteForeignEndpointClearances(this, routeId)
    }
    this.routeReplacementSolver?.invalidatePhysicalNeighborCache([
      ...routeIdSet,
    ])
  }

  private computeRegionMetricsWithoutRoutes(
    regionId: RegionId,
    removedRouteIds: ReadonlySet<RouteId>,
  ) {
    const intersectionOwnerIds: number[] = []
    const lesserAngles: number[] = []
    const greaterAngles: number[] = []
    const layerMasks: number[] = []
    const seenIntersectionOwnerIds = new Set<number>()
    let entryExitLayerChanges = 0
    let remainingSegmentCount = 0

    for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
      regionId
    ]!) {
      if (removedRouteIds.has(routeId)) continue
      remainingSegmentCount += 1
      const intersectionOwnerId = this.getIntersectionOwnerId(routeId)
      if (
        this.REGION_COST_MODEL === "routing-risk" &&
        seenIntersectionOwnerIds.has(intersectionOwnerId)
      ) {
        continue
      }
      seenIntersectionOwnerIds.add(intersectionOwnerId)
      const geometry = this.populateSegmentGeometryScratch(
        regionId,
        fromPortId,
        toPortId,
      )
      intersectionOwnerIds.push(intersectionOwnerId)
      lesserAngles.push(geometry.lesserAngle)
      greaterAngles.push(geometry.greaterAngle)
      layerMasks.push(geometry.layerMask)
      entryExitLayerChanges += geometry.entryExitLayerChanges
    }

    let sameLayerIntersections = 0
    let crossingLayerIntersections = 0
    for (
      let leftIndex = 0;
      leftIndex < intersectionOwnerIds.length;
      leftIndex++
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < intersectionOwnerIds.length;
        rightIndex++
      ) {
        if (
          intersectionOwnerIds[leftIndex] === intersectionOwnerIds[rightIndex]
        )
          continue
        if (
          this.REGION_COST_MODEL === "routing-risk" &&
          (lesserAngles[leftIndex] === lesserAngles[rightIndex] ||
            lesserAngles[leftIndex] === greaterAngles[rightIndex] ||
            greaterAngles[leftIndex] === lesserAngles[rightIndex] ||
            greaterAngles[leftIndex] === greaterAngles[rightIndex])
        ) {
          continue
        }
        const intersects =
          (lesserAngles[rightIndex]! < lesserAngles[leftIndex]! &&
            lesserAngles[leftIndex]! < greaterAngles[rightIndex]!) !==
          (lesserAngles[rightIndex]! < greaterAngles[leftIndex]! &&
            greaterAngles[leftIndex]! < greaterAngles[rightIndex]!)
        if (!intersects) continue

        const intersectionKind = classifyIntersectionLayerMasks(
          layerMasks[leftIndex]!,
          layerMasks[rightIndex]!,
          this.REGION_COST_MODEL,
        )
        if (intersectionKind === "same-layer") {
          sameLayerIntersections += 1
        } else if (intersectionKind === "transition-pair") {
          crossingLayerIntersections += 1
        }
      }
    }

    const physicalRisks = this.computePhysicalRoutingRisksForRegion(
      this,
      regionId,
      { removedRouteIds },
    )
    return {
      regionCost: this.computeRegionCostForRegion(
        regionId,
        sameLayerIntersections,
        crossingLayerIntersections,
        entryExitLayerChanges,
        intersectionOwnerIds.length,
      ),
      routingRisk: physicalRisks.groupedRisk,
      segmentRoutingRisk: physicalRisks.segmentRisk,
      downstreamRisk: physicalRisks.downstreamRisk,
      segmentCount: remainingSegmentCount,
    }
  }

  private summarizeSolverState(
    solver: TinyHyperGraphSolver,
  ): ScoredSolverState {
    let maxRegionCost = 0
    let totalRegionCost = 0
    let maxRoutingRisk = 0
    let squaredRoutingRisk = 0
    let totalRoutingRisk = 0
    let maxSegmentRoutingRisk = 0
    let squaredSegmentRoutingRisk = 0
    let totalSegmentRoutingRisk = 0
    let maxDownstreamRisk = 0
    let squaredDownstreamRisk = 0
    let totalDownstreamRisk = 0
    let maxRegionSegmentCount = 0
    let squaredRegionSegmentCount = 0
    let totalSegmentLength = 0
    const routingRiskByRegion = new Float64Array(
      solver.state.regionIntersectionCaches.length,
    )
    const segmentRoutingRiskByRegion = new Float64Array(
      solver.state.regionIntersectionCaches.length,
    )
    const downstreamRiskByRegion = new Float64Array(
      solver.state.regionIntersectionCaches.length,
    )
    const segmentLengthByRegion = new Float64Array(
      solver.state.regionIntersectionCaches.length,
    )
    for (
      let regionId = 0;
      regionId < solver.state.regionIntersectionCaches.length;
      regionId++
    ) {
      const cache = solver.state.regionIntersectionCaches[regionId]!
      maxRegionCost = Math.max(maxRegionCost, cache.existingRegionCost)
      totalRegionCost += cache.existingRegionCost
      maxRegionSegmentCount = Math.max(
        maxRegionSegmentCount,
        cache.existingSegmentCount,
      )
      squaredRegionSegmentCount += cache.existingSegmentCount ** 2
      for (const [, fromPortId, toPortId] of solver.state.regionSegments[
        regionId
      ]!) {
        const segmentLength = this.computeSegmentLength(
          solver,
          fromPortId,
          toPortId,
        )
        segmentLengthByRegion[regionId] += segmentLength
        totalSegmentLength += segmentLength
      }
      const {
        groupedRisk: routingRisk,
        segmentRisk,
        downstreamRisk,
      } = this.computePhysicalRoutingRisksForRegion(solver, regionId)
      routingRiskByRegion[regionId] = routingRisk
      segmentRoutingRiskByRegion[regionId] = segmentRisk
      downstreamRiskByRegion[regionId] = downstreamRisk
      maxRoutingRisk = Math.max(maxRoutingRisk, routingRisk)
      squaredRoutingRisk += routingRisk * routingRisk
      totalRoutingRisk += routingRisk
      maxSegmentRoutingRisk = Math.max(maxSegmentRoutingRisk, segmentRisk)
      squaredSegmentRoutingRisk += segmentRisk * segmentRisk
      totalSegmentRoutingRisk += segmentRisk
      maxDownstreamRisk = Math.max(maxDownstreamRisk, downstreamRisk)
      squaredDownstreamRisk += downstreamRisk * downstreamRisk
      totalDownstreamRisk += downstreamRisk
    }
    return {
      summary: {
        maxRegionCost,
        totalRegionCost,
        maxRegionSegmentCount,
        squaredRegionSegmentCount,
        totalSegmentLength,
        maxRoutingRisk,
        squaredRoutingRisk,
        totalRoutingRisk,
        maxSegmentRoutingRisk,
        squaredSegmentRoutingRisk,
        totalSegmentRoutingRisk,
        maxDownstreamRisk,
        squaredDownstreamRisk,
        totalDownstreamRisk,
      },
      routingRiskByRegion,
      segmentRoutingRiskByRegion,
      downstreamRiskByRegion,
      segmentLengthByRegion,
    }
  }

  /**
   * Scores a copy-on-write replacement state. Regions outside the removed and
   * replacement corridors are byte-for-byte identical to the current state,
   * so reuse their already validated geometry metrics and recompute only the
   * dirty frontier. The final objective is still aggregated across every
   * region, preserving exact max and total comparisons.
   */
  private summarizeReplacementSolverState(
    solver: SingleRouteReplacementSolver,
  ): ScoredSolverState {
    const routingRiskByRegion = new Float64Array(this.routingRiskByRegion)
    const segmentRoutingRiskByRegion = new Float64Array(
      this.segmentRoutingRiskByRegion,
    )
    const downstreamRiskByRegion = new Float64Array(this.downstreamRiskByRegion)
    const segmentLengthByRegion = new Float64Array(this.segmentLengthByRegion)

    for (const regionId of solver.getChangedRegionIds()) {
      let segmentLength = 0
      for (const [, fromPortId, toPortId] of solver.state.regionSegments[
        regionId
      ]!) {
        segmentLength += this.computeSegmentLength(solver, fromPortId, toPortId)
      }
      segmentLengthByRegion[regionId] = segmentLength
      const { groupedRisk, segmentRisk, downstreamRisk } =
        this.computePhysicalRoutingRisksForRegion(solver, regionId)
      routingRiskByRegion[regionId] = groupedRisk
      segmentRoutingRiskByRegion[regionId] = segmentRisk
      downstreamRiskByRegion[regionId] = downstreamRisk
    }

    let maxRegionCost = 0
    let totalRegionCost = 0
    let maxRoutingRisk = 0
    let squaredRoutingRisk = 0
    let totalRoutingRisk = 0
    let maxSegmentRoutingRisk = 0
    let squaredSegmentRoutingRisk = 0
    let totalSegmentRoutingRisk = 0
    let maxDownstreamRisk = 0
    let squaredDownstreamRisk = 0
    let totalDownstreamRisk = 0
    let maxRegionSegmentCount = 0
    let squaredRegionSegmentCount = 0
    let totalSegmentLength = 0
    for (
      let regionId = 0;
      regionId < solver.state.regionIntersectionCaches.length;
      regionId++
    ) {
      const cache = solver.state.regionIntersectionCaches[regionId]!
      const routingRisk = routingRiskByRegion[regionId]!
      const downstreamRisk = downstreamRiskByRegion[regionId]!
      maxRegionCost = Math.max(maxRegionCost, cache.existingRegionCost)
      totalRegionCost += cache.existingRegionCost
      maxRegionSegmentCount = Math.max(
        maxRegionSegmentCount,
        cache.existingSegmentCount,
      )
      squaredRegionSegmentCount += cache.existingSegmentCount ** 2
      totalSegmentLength += segmentLengthByRegion[regionId]!
      maxRoutingRisk = Math.max(maxRoutingRisk, routingRisk)
      squaredRoutingRisk += routingRisk * routingRisk
      totalRoutingRisk += routingRisk
      maxSegmentRoutingRisk = Math.max(
        maxSegmentRoutingRisk,
        segmentRoutingRiskByRegion[regionId]!,
      )
      squaredSegmentRoutingRisk += segmentRoutingRiskByRegion[regionId]! ** 2
      totalSegmentRoutingRisk += segmentRoutingRiskByRegion[regionId]!
      maxDownstreamRisk = Math.max(maxDownstreamRisk, downstreamRisk)
      squaredDownstreamRisk += downstreamRisk * downstreamRisk
      totalDownstreamRisk += downstreamRisk
    }

    return {
      summary: {
        maxRegionCost,
        totalRegionCost,
        maxRegionSegmentCount,
        squaredRegionSegmentCount,
        totalSegmentLength,
        maxRoutingRisk,
        squaredRoutingRisk,
        totalRoutingRisk,
        maxSegmentRoutingRisk,
        squaredSegmentRoutingRisk,
        totalSegmentRoutingRisk,
        maxDownstreamRisk,
        squaredDownstreamRisk,
        totalDownstreamRisk,
      },
      routingRiskByRegion,
      segmentRoutingRiskByRegion,
      downstreamRiskByRegion,
      segmentLengthByRegion,
    }
  }

  private summarizeStateWithoutRoute(
    routeId: RouteId,
  ): UnravelRegionCostSummary {
    return this.summarizeStateWithoutRoutes([routeId])
  }

  private summarizeStateWithoutRoutes(
    routeIds: RouteId[],
  ): UnravelRegionCostSummary {
    const removedRouteIds = new Set(routeIds)
    let maxRegionCost = 0
    let totalRegionCost = 0
    let maxRoutingRisk = 0
    let squaredRoutingRisk = 0
    let totalRoutingRisk = 0
    let maxSegmentRoutingRisk = 0
    let squaredSegmentRoutingRisk = 0
    let totalSegmentRoutingRisk = 0
    let maxDownstreamRisk = 0
    let squaredDownstreamRisk = 0
    let totalDownstreamRisk = 0
    let maxRegionSegmentCount = 0
    let squaredRegionSegmentCount = 0
    const totalSegmentLength =
      this.currentSummary.totalSegmentLength -
      routeIds.reduce(
        (total, routeId) => total + this.routeSegmentLengthByRouteId[routeId]!,
        0,
      )

    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      const cache = this.state.regionIntersectionCaches[regionId]!
      const regionMetrics = this.state.regionSegments[regionId]!.some(
        ([segmentRouteId]) => removedRouteIds.has(segmentRouteId),
      )
        ? this.computeRegionMetricsWithoutRoutes(regionId, removedRouteIds)
        : {
            regionCost: cache.existingRegionCost,
            routingRisk: this.routingRiskByRegion[regionId]!,
            segmentRoutingRisk: this.segmentRoutingRiskByRegion[regionId]!,
            downstreamRisk: this.downstreamRiskByRegion[regionId]!,
            segmentCount: cache.existingSegmentCount,
          }
      maxRegionCost = Math.max(maxRegionCost, regionMetrics.regionCost)
      totalRegionCost += regionMetrics.regionCost
      maxRoutingRisk = Math.max(maxRoutingRisk, regionMetrics.routingRisk)
      squaredRoutingRisk += regionMetrics.routingRisk ** 2
      totalRoutingRisk += regionMetrics.routingRisk
      maxSegmentRoutingRisk = Math.max(
        maxSegmentRoutingRisk,
        regionMetrics.segmentRoutingRisk,
      )
      squaredSegmentRoutingRisk += regionMetrics.segmentRoutingRisk ** 2
      totalSegmentRoutingRisk += regionMetrics.segmentRoutingRisk
      maxDownstreamRisk = Math.max(
        maxDownstreamRisk,
        regionMetrics.downstreamRisk,
      )
      squaredDownstreamRisk += regionMetrics.downstreamRisk ** 2
      totalDownstreamRisk += regionMetrics.downstreamRisk
      maxRegionSegmentCount = Math.max(
        maxRegionSegmentCount,
        regionMetrics.segmentCount,
      )
      squaredRegionSegmentCount += regionMetrics.segmentCount ** 2
    }

    return {
      maxRegionCost,
      totalRegionCost,
      maxRegionSegmentCount,
      squaredRegionSegmentCount,
      totalSegmentLength,
      maxRoutingRisk,
      squaredRoutingRisk,
      totalRoutingRisk,
      maxSegmentRoutingRisk,
      squaredSegmentRoutingRisk,
      totalSegmentRoutingRisk,
      maxDownstreamRisk,
      squaredDownstreamRisk,
      totalDownstreamRisk,
    }
  }

  private computePrimaryRegionMetricsAfterPermutation(
    regionId: RegionId,
    permutation: BoundaryPermutation,
  ) {
    const intersectionOwnerIds: number[] = []
    const lesserAngles: number[] = []
    const greaterAngles: number[] = []
    const layerMasks: number[] = []
    const seenIntersectionOwnerIds = new Set<number>()
    let entryExitLayerChanges = 0
    let segmentLength = 0

    for (const [routeId, originalFromPortId, originalToPortId] of this.state
      .regionSegments[regionId]!) {
      const fromPortId = this.remapPortForBoundaryPermutation(
        routeId,
        originalFromPortId,
        permutation,
      )
      const toPortId = this.remapPortForBoundaryPermutation(
        routeId,
        originalToPortId,
        permutation,
      )

      segmentLength += this.computeSegmentLength(this, fromPortId, toPortId)

      const geometry = this.populateSegmentGeometryScratch(
        regionId,
        fromPortId,
        toPortId,
      )
      const intersectionOwnerId = this.getIntersectionOwnerId(routeId)
      if (
        this.REGION_COST_MODEL === "routing-risk" &&
        seenIntersectionOwnerIds.has(intersectionOwnerId)
      ) {
        continue
      }
      seenIntersectionOwnerIds.add(intersectionOwnerId)
      intersectionOwnerIds.push(intersectionOwnerId)
      lesserAngles.push(geometry.lesserAngle)
      greaterAngles.push(geometry.greaterAngle)
      layerMasks.push(geometry.layerMask)
      entryExitLayerChanges += geometry.entryExitLayerChanges
    }

    let sameLayerIntersections = 0
    let crossingLayerIntersections = 0
    for (
      let leftIndex = 0;
      leftIndex < intersectionOwnerIds.length;
      leftIndex++
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < intersectionOwnerIds.length;
        rightIndex++
      ) {
        if (
          intersectionOwnerIds[leftIndex] === intersectionOwnerIds[rightIndex]
        )
          continue
        if (
          this.REGION_COST_MODEL === "routing-risk" &&
          (lesserAngles[leftIndex] === lesserAngles[rightIndex] ||
            lesserAngles[leftIndex] === greaterAngles[rightIndex] ||
            greaterAngles[leftIndex] === lesserAngles[rightIndex] ||
            greaterAngles[leftIndex] === greaterAngles[rightIndex])
        ) {
          continue
        }
        const intersects =
          (lesserAngles[rightIndex]! < lesserAngles[leftIndex]! &&
            lesserAngles[leftIndex]! < greaterAngles[rightIndex]!) !==
          (lesserAngles[rightIndex]! < greaterAngles[leftIndex]! &&
            greaterAngles[leftIndex]! < greaterAngles[rightIndex]!)
        if (!intersects) continue

        const intersectionKind = classifyIntersectionLayerMasks(
          layerMasks[leftIndex]!,
          layerMasks[rightIndex]!,
          this.REGION_COST_MODEL,
        )
        if (intersectionKind === "same-layer") {
          sameLayerIntersections += 1
        } else if (intersectionKind === "transition-pair") {
          crossingLayerIntersections += 1
        }
      }
    }

    return {
      regionCost: this.computeRegionCostForRegion(
        regionId,
        sameLayerIntersections,
        crossingLayerIntersections,
        entryExitLayerChanges,
        intersectionOwnerIds.length,
      ),
      segmentLength,
    }
  }

  private applyBoundaryMutation(mutation: BoundaryMutation) {
    // Cached replacement paths were expressed in the old boundary-port
    // coordinates. Carry them through the same atomic permutation so they
    // remain candidates after the untwist descent. Every transformed path is
    // still ownership-validated and fully rescored before use.
    this.remapStoredReroutePaths(mutation.permutation)

    for (const regionId of [mutation.region1Id, mutation.region2Id]) {
      for (const segment of this.state.regionSegments[regionId]!) {
        segment[1] = this.remapPortForBoundaryPermutation(
          segment[0],
          segment[1],
          mutation.permutation,
        )
        segment[2] = this.remapPortForBoundaryPermutation(
          segment[0],
          segment[2],
          mutation.permutation,
        )
      }
    }

    for (let index = 0; index < mutation.permutation.slots.length; index++) {
      const source = mutation.permutation.slots[index]!
      const destinationPortId = mutation.permutation.destinationPortIds[index]!
      this.state.portAssignment[destinationPortId] =
        source.routeId === undefined
          ? -1
          : this.problem.routeNet[source.routeId]!
    }
    this.rebuildRegionCache(mutation.region1Id)
    this.rebuildRegionCache(mutation.region2Id)
    this.routingRiskByRegion[mutation.region1Id] = mutation.region1RoutingRisk
    this.routingRiskByRegion[mutation.region2Id] = mutation.region2RoutingRisk
    this.segmentRoutingRiskByRegion[mutation.region1Id] =
      mutation.region1SegmentRoutingRisk
    this.segmentRoutingRiskByRegion[mutation.region2Id] =
      mutation.region2SegmentRoutingRisk
    this.downstreamRiskByRegion[mutation.region1Id] =
      mutation.region1DownstreamRisk
    this.downstreamRiskByRegion[mutation.region2Id] =
      mutation.region2DownstreamRisk
    this.segmentLengthByRegion[mutation.region1Id] =
      mutation.region1SegmentLength
    this.segmentLengthByRegion[mutation.region2Id] =
      mutation.region2SegmentLength
    this.recomputeRouteMetrics(
      mutation.permutation.slots.flatMap(({ routeId }) =>
        routeId === undefined ? [] : [routeId],
      ),
    )
  }

  private remapReroutePath(
    routeId: RouteId,
    path: ReplacementPathSegment[],
    permutation: BoundaryPermutation,
  ) {
    for (const segment of path) {
      segment.fromPortId = this.remapPortForBoundaryPermutation(
        routeId,
        segment.fromPortId,
        permutation,
      )
      segment.toPortId = this.remapPortForBoundaryPermutation(
        routeId,
        segment.toPortId,
        permutation,
      )
    }
  }

  private remapStoredReroutePaths(permutation: BoundaryPermutation) {
    for (const cachedPath of this.pendingReroutePaths) {
      this.remapReroutePath(
        cachedPath.routeId,
        cachedPath.replacementPath,
        permutation,
      )
    }
    for (const acceptedMutation of this.acceptedRerouteMutations) {
      for (const previousPath of acceptedMutation.previousPaths) {
        this.remapReroutePath(
          previousPath.routeId,
          previousPath.path,
          permutation,
        )
      }
    }
  }

  private getRoutePath(routeId: RouteId): ReplacementPathSegment[] {
    return this.state.regionSegments.flatMap((segments, regionId) =>
      segments.flatMap(([candidateRouteId, fromPortId, toPortId]) =>
        candidateRouteId === routeId
          ? [{ regionId, fromPortId, toPortId }]
          : [],
      ),
    )
  }

  private applyRerouteMutation(mutation: RerouteMutation) {
    this.state.portAssignment = mutation.replacementState.portAssignment
    this.state.regionSegments = mutation.replacementState.regionSegments
    this.state.regionIntersectionCaches =
      mutation.replacementState.regionIntersectionCaches
    this.state.regionCongestionCost = new Float64Array(
      this.inputSolver.state.regionCongestionCost,
    )
    this.state.ripCount = this.inputSolver.state.ripCount
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    this.routingRiskByRegion.set(mutation.routingRiskByRegion)
    this.segmentRoutingRiskByRegion.set(mutation.segmentRoutingRiskByRegion)
    this.downstreamRiskByRegion.set(mutation.downstreamRiskByRegion)
    this.segmentLengthByRegion.set(mutation.segmentLengthByRegion)
    for (const {
      routeId,
      layerChangeCount,
      segmentLength,
      foreignEndpointClearances,
    } of mutation.replacementRouteMetrics) {
      this.routeLayerChangeCountByRouteId[routeId] = layerChangeCount
      this.routeSegmentLengthByRouteId[routeId] = segmentLength
      this.routeForeignEndpointClearancesByRouteId[routeId] =
        foreignEndpointClearances
    }
    this.routeReplacementSolver?.invalidatePhysicalNeighborCache(
      mutation.replacementRouteMetrics.map(({ routeId }) => routeId),
    )
  }

  private getIntersectionOwnerId(routeId: RouteId): number {
    return this.REGION_COST_MODEL === "routing-risk"
      ? routeId
      : this.problem.routeNet[routeId]!
  }

  private rebuildRegionCache(regionId: RegionId) {
    this.state.regionSegments[regionId]!.sort(
      (left, right) => left[0] - right[0],
    )
    this.state.regionIntersectionCaches[regionId] =
      createEmptyRegionIntersectionCache()
    for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
      regionId
    ]!) {
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = this.problem.routeNet[routeId]
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
  }

  private isPathRelinkingCandidateAllowed(
    summary: UnravelRegionCostSummary,
    achievedMaxRegionCost: number,
  ) {
    return (
      summary.maxRegionCost <= achievedMaxRegionCost + COST_EPSILON &&
      summary.totalRegionCost <=
        this.initialSummary.totalRegionCost + COST_EPSILON &&
      summary.maxRegionSegmentCount <=
        this.currentSummary.maxRegionSegmentCount &&
      summary.squaredRegionSegmentCount <=
        this.currentSummary.squaredRegionSegmentCount &&
      summary.totalSegmentLength <=
        this.currentSummary.totalSegmentLength + COST_EPSILON &&
      isRoutingRiskNoWorse(summary, this.initialSummary, this.initialSummary) &&
      summary.squaredSegmentRoutingRisk <=
        this.initialSummary.squaredSegmentRoutingRisk + COST_EPSILON &&
      summary.totalSegmentRoutingRisk <=
        this.initialSummary.totalSegmentRoutingRisk + COST_EPSILON
    )
  }

  private countTotalLayerChanges(solver: TinyHyperGraphSolver): number {
    let layerChangeCount = 0
    for (const segments of solver.state.regionSegments) {
      for (const [, fromPortId, toPortId] of segments) {
        if (this.topology.portZ[fromPortId] !== this.topology.portZ[toPortId]) {
          layerChangeCount += 1
        }
      }
    }
    return layerChangeCount
  }

  /**
   * Plateau untwists are useful as temporary ejection-chain moves, but a
   * solved chain should not retain every intermediate lane displacement. Walk
   * the accepted boundary history backwards and remove a permutation when the
   * achieved peak is preserved, wirelength does not increase, and all physical
   * metrics remain inside the original solved state's feasibility envelope.
   */
  private removeRedundantBoundaryMutations(achievedMaxRegionCost: number) {
    for (
      let mutationIndex = this.acceptedBoundaryMutations.length - 1;
      mutationIndex >= 0;
      mutationIndex--
    ) {
      const mutation = this.acceptedBoundaryMutations[mutationIndex]!
      if (this.revertedBoundaryMutations.has(mutation)) continue
      const inversePermutation: BoundaryPermutation = {
        slots: mutation.permutation.slots.map((slot, index) => ({
          ...slot,
          portId: mutation.permutation.destinationPortIds[index]!,
        })),
        destinationPortIds: mutation.permutation.slots.map(
          ({ portId }) => portId,
        ),
      }
      const sourcePortIds = new Set(
        mutation.permutation.slots.map(({ portId }) => portId),
      )
      if (
        sourcePortIds.size !== inversePermutation.destinationPortIds.length ||
        inversePermutation.destinationPortIds.some(
          (portId) => !mutation.permutation.destinationPortIds.includes(portId),
        )
      ) {
        continue
      }

      const regionIds = [mutation.region1Id, mutation.region2Id]
      const stillApplied = inversePermutation.slots.every((slot) => {
        const expectedNetId =
          slot.routeId === undefined ? -1 : this.problem.routeNet[slot.routeId]!
        if (this.state.portAssignment[slot.portId] !== expectedNetId) {
          return false
        }
        return regionIds.every((regionId) => {
          const occurrences = this.state.regionSegments[regionId]!.filter(
            ([routeId, fromPortId, toPortId]) =>
              (fromPortId === slot.portId || toPortId === slot.portId) &&
              (slot.routeId === undefined || routeId === slot.routeId),
          )
          return slot.routeId === undefined
            ? occurrences.length === 0
            : occurrences.length === 1
        })
      })
      if (!stillApplied) continue
      if (
        !this.preservesFixedBoundaryOrder(
          inversePermutation,
          mutation.fixedAnchorPortIds,
        ) ||
        (this.REGION_COST_MODEL === "routing-complexity" &&
          !this.preservesRouteLayerChangeCountsAfterPermutation(
            inversePermutation,
          )) ||
        this.boundaryPermutationViolatesForeignEndpointKeepout(
          inversePermutation,
        )
      ) {
        continue
      }

      const savedRegionSegments = regionIds.map((regionId) =>
        this.state.regionSegments[regionId]!.map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
        ),
      )
      const boundaryPortIds = mutation.permutation.slots.map(
        ({ portId }) => portId,
      )
      const savedPortAssignments = boundaryPortIds.map(
        (portId) => this.state.portAssignment[portId]!,
      )
      const currentLayerChangeCount = this.countTotalLayerChanges(this)

      for (const regionId of regionIds) {
        for (const segment of this.state.regionSegments[regionId]!) {
          segment[1] = this.remapPortForBoundaryPermutation(
            segment[0],
            segment[1],
            inversePermutation,
          )
          segment[2] = this.remapPortForBoundaryPermutation(
            segment[0],
            segment[2],
            inversePermutation,
          )
        }
      }
      for (let index = 0; index < inversePermutation.slots.length; index++) {
        const source = inversePermutation.slots[index]!
        const destinationPortId = inversePermutation.destinationPortIds[index]!
        this.state.portAssignment[destinationPortId] =
          source.routeId === undefined
            ? -1
            : this.problem.routeNet[source.routeId]!
      }
      for (const regionId of regionIds) this.rebuildRegionCache(regionId)

      const candidate = this.summarizeSolverState(this)
      const summary = candidate.summary
      if (
        this.isPathRelinkingCandidateAllowed(summary, achievedMaxRegionCost) &&
        this.countTotalLayerChanges(this) <= currentLayerChangeCount
      ) {
        this.currentSummary = summary
        this.routingRiskByRegion.set(candidate.routingRiskByRegion)
        this.segmentRoutingRiskByRegion.set(
          candidate.segmentRoutingRiskByRegion,
        )
        this.downstreamRiskByRegion.set(candidate.downstreamRiskByRegion)
        this.segmentLengthByRegion.set(candidate.segmentLengthByRegion)
        this.recomputeRouteMetrics(
          inversePermutation.slots.flatMap(({ routeId }) =>
            routeId === undefined ? [] : [routeId],
          ),
        )
        this.remapStoredReroutePaths(inversePermutation)
        this.revertedBoundaryMutations.add(mutation)
        this.revertedBoundaryMutationCount += 1
        continue
      }

      for (let regionIndex = 0; regionIndex < regionIds.length; regionIndex++) {
        this.state.regionSegments[regionIds[regionIndex]!] =
          savedRegionSegments[regionIndex]!
        this.rebuildRegionCache(regionIds[regionIndex]!)
      }
      for (let index = 0; index < boundaryPortIds.length; index++) {
        this.state.portAssignment[boundaryPortIds[index]!] =
          savedPortAssignments[index]!
      }
    }
  }

  /**
   * A peak-reducing route replacement can make an earlier replacement
   * unnecessary. Relink the final solution toward the solved input by
   * restoring accepted paths in reverse order whenever the achieved peak is
   * unchanged. The rollback may not add segments, transitions, wirelength, or
   * physical risk beyond the solved-input envelope.
   */
  private removeRedundantRerouteMutations(achievedMaxRegionCost: number) {
    const candidateSolver = this.routeReplacementSolver
    if (!candidateSolver) return

    for (
      let mutationIndex = this.acceptedRerouteMutations.length - 1;
      mutationIndex >= 0;
      mutationIndex--
    ) {
      const acceptedMutation = this.acceptedRerouteMutations[mutationIndex]!
      if (acceptedMutation.reverted) continue

      const currentPaths = acceptedMutation.routeIds.map((routeId) =>
        this.getRoutePath(routeId),
      )
      const previousSegmentCount = acceptedMutation.previousPaths.reduce(
        (count, { path }) => count + path.length,
        0,
      )
      const currentSegmentCount = currentPaths.reduce(
        (count, path) => count + path.length,
        0,
      )
      if (previousSegmentCount > currentSegmentCount) continue

      const addsLayerChanges = acceptedMutation.previousPaths.some(
        ({ routeId, path }) =>
          path.filter(
            ({ fromPortId, toPortId }) =>
              this.topology.portZ[fromPortId] !== this.topology.portZ[toPortId],
          ).length > this.routeLayerChangeCountByRouteId[routeId]!,
      )
      if (addsLayerChanges) continue

      if (
        !candidateSolver.loadReplacementPaths(
          this,
          acceptedMutation.previousPaths,
          0,
        )
      ) {
        continue
      }
      const endpointKeepout = this.replacementViolatesForeignEndpointKeepout(
        candidateSolver,
        acceptedMutation.routeIds,
      )
      if (endpointKeepout.violates) continue

      candidateSolver.rescoreForOptimizer(this)
      const candidate = this.summarizeReplacementSolverState(candidateSolver)
      const summary = candidate.summary
      if (!this.isPathRelinkingCandidateAllowed(summary, achievedMaxRegionCost))
        continue

      this.applyRerouteMutation({
        kind: "reroute",
        routeId: Math.min(...acceptedMutation.routeIds),
        routeIds: [...acceptedMutation.routeIds],
        congestionFactor: 0,
        replacementPath: [],
        replacementState: candidateSolver.getReplacementState(),
        replacementRouteMetrics: acceptedMutation.routeIds.map(
          (routeId, routeIndex) => ({
            routeId,
            layerChangeCount:
              candidateSolver.replacementRouteLayerChangeCountByRouteId[
                routeId
              ]!,
            segmentLength:
              candidateSolver.replacementRouteSegmentLengthByRouteId[routeId]!,
            foreignEndpointClearances: endpointKeepout.clearances[routeIndex]!,
          }),
        ),
        routingRiskByRegion: candidate.routingRiskByRegion,
        segmentRoutingRiskByRegion: candidate.segmentRoutingRiskByRegion,
        downstreamRiskByRegion: candidate.downstreamRiskByRegion,
        segmentLengthByRegion: candidate.segmentLengthByRegion,
        summary,
      })
      this.currentSummary = summary
      acceptedMutation.reverted = true
      this.revertedRerouteMutationCount += 1
    }
  }

  private restoreInputStateAfterUnproductivePlateauSearch() {
    this.state.portAssignment = new Int32Array(
      this.inputSolver.state.portAssignment,
    )
    const restoredRegionSegments = this.inputSolver.state.regionSegments.map(
      (segments) =>
        segments.map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
        ),
    )
    this.state.regionSegments = restoredRegionSegments.map((segments) =>
      segments.map(
        ([routeId, fromPortId, toPortId]) =>
          [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
      ),
    )
    this.state.regionCongestionCost.fill(0)
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1

    for (let regionId = 0; regionId < this.topology.regionCount; regionId++) {
      this.rebuildRegionCache(regionId)
    }
    const restored = this.summarizeSolverState(this)
    // Cache rebuilding uses canonical route-id order. The detailed router also
    // consumes assignment order, so restore that byte-for-byte after scoring.
    this.state.regionSegments = restoredRegionSegments
    this.currentSummary = restored.summary
    this.routingRiskByRegion.set(restored.routingRiskByRegion)
    this.segmentRoutingRiskByRegion.set(restored.segmentRoutingRiskByRegion)
    this.downstreamRiskByRegion.set(restored.downstreamRiskByRegion)
    this.segmentLengthByRegion.set(restored.segmentLengthByRegion)
    this.recomputeRouteMetrics(
      Array.from({ length: this.problem.routeCount }, (_, routeId) => routeId),
    )
  }

  private finishOptimization(
    reason: "local_optimum" | "mutation_limit" | "reroute_limit",
  ) {
    const rolledBackPlateauMutations =
      this.acceptedMutationCount > 0 &&
      this.currentSummary.maxRegionCost >=
        this.initialSummary.maxRegionCost - COST_EPSILON
    if (rolledBackPlateauMutations) {
      this.restoreInputStateAfterUnproductivePlateauSearch()
    } else if (
      this.currentSummary.maxRegionCost <
      this.initialSummary.maxRegionCost - COST_EPSILON
    ) {
      this.removeRedundantBoundaryMutations(this.currentSummary.maxRegionCost)
      this.removeRedundantRerouteMutations(this.currentSummary.maxRegionCost)
      this.removeRedundantBoundaryMutations(this.currentSummary.maxRegionCost)
    }
    const finalPeakRegionIds = this.state.regionIntersectionCaches
      .map((cache, regionId) => ({
        regionId,
        cost: cache.existingRegionCost,
      }))
      .filter(
        ({ cost }) =>
          Math.abs(cost - this.currentSummary.maxRegionCost) <= COST_EPSILON,
      )
      .map(({ regionId }) => regionId)
    const finalPeakRouteIds = [
      ...new Set(
        finalPeakRegionIds.flatMap((regionId) =>
          this.state.regionSegments[regionId]!.map(([routeId]) => routeId),
        ),
      ),
    ].sort((left, right) => left - right)
    this.stats = {
      ...this.stats,
      finalMaxRegionCost: this.currentSummary.maxRegionCost,
      finalTotalRegionCost: this.currentSummary.totalRegionCost,
      finalTotalSegmentLength: this.currentSummary.totalSegmentLength,
      finalMaxRoutingRisk: this.currentSummary.maxRoutingRisk,
      finalTotalRoutingRisk: this.currentSummary.totalRoutingRisk,
      finalMaxSegmentRoutingRisk: this.currentSummary.maxSegmentRoutingRisk,
      finalTotalSegmentRoutingRisk: this.currentSummary.totalSegmentRoutingRisk,
      finalMaxDownstreamRisk: this.currentSummary.maxDownstreamRisk,
      finalTotalDownstreamRisk: this.currentSummary.totalDownstreamRisk,
      finalMinForeignEndpointClearance:
        this.getMinimumForeignEndpointClearance(),
      acceptedMutationCount: this.acceptedMutationCount,
      acceptedSwapMutationCount: this.acceptedSwapMutationCount,
      acceptedCycleMutationCount: this.acceptedCycleMutationCount,
      acceptedRerouteMutationCount: this.acceptedRerouteMutationCount,
      acceptedPairRerouteMutationCount: this.acceptedPairRerouteMutationCount,
      evaluatedMutationCount: this.evaluatedMutationCount,
      rejectedRerouteDetourCount: this.rejectedRerouteDetourCount,
      rejectedRerouteLayerChangeCount: this.rejectedRerouteLayerChangeCount,
      rejectedReroutePhysicalRiskCount: this.rejectedReroutePhysicalRiskCount,
      rejectedRerouteEndpointKeepoutCount:
        this.rejectedRerouteEndpointKeepoutCount,
      prunedRerouteEndpointKeepoutSegmentCount:
        this.prunedRerouteEndpointKeepoutSegmentCount,
      rejectedBoundaryEndpointKeepoutCount:
        this.rejectedBoundaryEndpointKeepoutCount,
      rejectedFixedBoundaryOrderCount: this.rejectedFixedBoundaryOrderCount,
      terminalKeepoutCount: this.terminalKeepouts.length,
      terminalKeepoutCellSize: this.terminalKeepoutCellSize,
      terminalKeepoutBroadPhaseQueryCount:
        this.terminalKeepoutBroadPhaseQueryCount,
      terminalKeepoutBroadPhaseCandidateCount:
        this.terminalKeepoutBroadPhaseCandidateCount,
      terminalKeepoutExactCheckCount: this.terminalKeepoutExactCheckCount,
      terminalKeepoutGeometryCacheHitCount:
        this.terminalKeepoutGeometryCacheHitCount,
      terminalKeepoutNeighborPartitionCacheHitCount:
        this.terminalKeepoutNeighborPartitionCacheHitCount,
      terminalKeepoutNeighborPartitionCacheMissCount:
        this.terminalKeepoutNeighborPartitionCacheMissCount,
      terminalKeepoutGeometryCacheSize: this.terminalKeepoutGeometries.length,
      terminalKeepoutPhysicalNeighborCacheHitCount:
        this.routeReplacementSolver?.physicalNeighborCacheHitCount ?? 0,
      terminalKeepoutPhysicalNeighborCacheMissCount:
        this.routeReplacementSolver?.physicalNeighborCacheMissCount ?? 0,
      replacementRegionCostCacheHitCount:
        this.replacementRegionCostCacheHitCount,
      replacementRegionCostCacheMissCount:
        this.replacementRegionCostCacheMissCount,
      rejectedCrossLayerSwapCount: this.rejectedCrossLayerSwapCount,
      prunedRerouteSearchCount: this.prunedRerouteSearchCount,
      rerouteSearchIterationCount: this.rerouteSearchIterationCount,
      rerouteSearchCount: this.rerouteSearchCount,
      singleRerouteSearchIterationCount: this.singleRerouteSearchIterationCount,
      singleRerouteSearchCount: this.singleRerouteSearchCount,
      singleRerouteFailedSearchIterationCount:
        this.singleRerouteFailedSearchIterationCount,
      singleRerouteFailedSearchCount: this.singleRerouteFailedSearchCount,
      pairRerouteSearchIterationCount: this.pairRerouteSearchIterationCount,
      pairRerouteSearchCount: this.pairRerouteSearchCount,
      pairRerouteFailedSearchIterationCount:
        this.pairRerouteFailedSearchIterationCount,
      pairRerouteFailedSearchCount: this.pairRerouteFailedSearchCount,
      reusedRerouteCandidateCount: this.reusedRerouteCandidateCount,
      revertedBoundaryMutationCount: this.revertedBoundaryMutationCount,
      revertedRerouteMutationCount: this.revertedRerouteMutationCount,
      optimizationStopReason: reason,
      rolledBackPlateauMutations,
      finalPeakRegionIds,
      finalPeakRouteIds,
      optimized:
        compareRegionCostSummaries(this.currentSummary, this.initialSummary) <
        0,
    }
    this.solved = true
  }

  override tryFinalAcceptance() {
    this.finishOptimization("mutation_limit")
    this.failed = false
    this.error = null
  }
}
