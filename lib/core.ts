import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import { computeRegionCost, isKnownSingleLayerMask } from "./computeRegionCost"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import { MinHeap } from "./MinHeap"
import { shuffle } from "./shuffle"
import {
  createStaticallyUnroutableRouteSummary,
  getStaticReachabilityError,
  getStaticallyUnroutableRoutes,
} from "./static-reachability"
import type { StaticallyUnroutableRouteSummary } from "./static-reachability"
import type {
  DynamicAnglePair,
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
  candidateBestCostByHopId: Float64Array
  candidateBestCostGenerationByHopId: Uint32Array
  candidateBestCostGeneration: number

  goalPortId: PortId

  ripCount: number

  /** regionCongestionCost[regionId] = congestion cost */
  regionCongestionCost: Float64Array
}

export interface TinyHyperGraphSolverOptions {
  DISTANCE_TO_COST?: number
  RIP_THRESHOLD_START?: number
  RIP_THRESHOLD_END?: number
  RIP_THRESHOLD_RAMP_ATTEMPTS?: number
  RIP_CONGESTION_REGION_COST_FACTOR?: number
  MAX_ITERATIONS?: number
  VERBOSE?: boolean
  STATIC_REACHABILITY_PRECHECK?: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS?: number
}

export interface TinyHyperGraphSolverOptionTarget {
  DISTANCE_TO_COST: number
  RIP_THRESHOLD_START: number
  RIP_THRESHOLD_END: number
  RIP_THRESHOLD_RAMP_ATTEMPTS: number
  RIP_CONGESTION_REGION_COST_FACTOR: number
  MAX_ITERATIONS: number
  VERBOSE: boolean
  STATIC_REACHABILITY_PRECHECK: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS: number
}

export const applyTinyHyperGraphSolverOptions = (
  solver: TinyHyperGraphSolverOptionTarget,
  options?: TinyHyperGraphSolverOptions,
) => {
  if (!options) {
    return
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
}

export const getTinyHyperGraphSolverOptions = (
  solver: TinyHyperGraphSolverOptionTarget,
): TinyHyperGraphSolverOptions => ({
  DISTANCE_TO_COST: solver.DISTANCE_TO_COST,
  RIP_THRESHOLD_START: solver.RIP_THRESHOLD_START,
  RIP_THRESHOLD_END: solver.RIP_THRESHOLD_END,
  RIP_THRESHOLD_RAMP_ATTEMPTS: solver.RIP_THRESHOLD_RAMP_ATTEMPTS,
  RIP_CONGESTION_REGION_COST_FACTOR: solver.RIP_CONGESTION_REGION_COST_FACTOR,
  MAX_ITERATIONS: solver.MAX_ITERATIONS,
  VERBOSE: solver.VERBOSE,
  STATIC_REACHABILITY_PRECHECK: solver.STATIC_REACHABILITY_PRECHECK,
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS:
    solver.STATIC_REACHABILITY_PRECHECK_MAX_HOPS,
})

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f

const IMPROVEMENT_EPSILON = 1e-9

interface SegmentGeometryScratch {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

interface SolvedRouteSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

interface OrderedRoutePath {
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
}

interface RoutePortTraversal {
  routeId: RouteId
  portId: PortId
  regionId1: RegionId
  regionId2: RegionId
  otherPortIdInRegion1: PortId
  otherPortIdInRegion2: PortId
  edgeKey: string
  solvedSegmentIndex?: number
}

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

const cloneRegionSegments = (
  regionSegments: Array<[RouteId, PortId, PortId][]>,
): Array<[RouteId, PortId, PortId][]> =>
  regionSegments.map((segments) =>
    segments.map(
      ([routeId, fromPortId, toPortId]) =>
        [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
    ),
  )

const compareRegionCostSummaries = (
  left: RegionCostSummary,
  right: RegionCostSummary,
) => {
  if (
    Math.abs(left.maxRegionCost - right.maxRegionCost) > IMPROVEMENT_EPSILON
  ) {
    return left.maxRegionCost - right.maxRegionCost
  }

  return left.totalRegionCost - right.totalRegionCost
}

const summarizeRegionCostsForRegionIds = (
  regionIds: RegionId[],
  getRegionCache: (regionId: RegionId) => RegionIntersectionCache | undefined,
): RegionCostSummary => {
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (const regionId of regionIds) {
    const regionCost = getRegionCache(regionId)?.existingRegionCost ?? 0
    maxRegionCost = Math.max(maxRegionCost, regionCost)
    totalRegionCost += regionCost
  }

  return {
    maxRegionCost,
    totalRegionCost,
  }
}

const getRegionPairKey = (regionId1: RegionId, regionId2: RegionId) =>
  regionId1 < regionId2
    ? `${regionId1}:${regionId2}`
    : `${regionId2}:${regionId1}`

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  private _problemSetup?: TinyHyperGraphProblemSetup
  protected routeAttemptCountByRouteId: Uint32Array
  protected routeSuccessCountByRouteId: Uint32Array
  private hasLoggedNeverSuccessfullyRoutedRoutes = false
  private segmentGeometryScratch: SegmentGeometryScratch = {
    lesserAngle: 0,
    greaterAngle: 0,
    layerMask: 0,
    entryExitLayerChanges: 0,
  }

  DISTANCE_TO_COST = 0.05 // 50mm = 1 cost unit (1 cost unit ~ 100% chance of failure)

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1

  override MAX_ITERATIONS = 1e6
  VERBOSE = false
  STATIC_REACHABILITY_PRECHECK = true
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS = 16

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
      candidateBestCostByHopId: new Float64Array(
        topology.portCount * topology.regionCount,
      ),
      candidateBestCostGenerationByHopId: new Uint32Array(
        topology.portCount * topology.regionCount,
      ),
      candidateBestCostGeneration: 1,
      goalPortId: -1,
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
    const portX = topology.portX as unknown as ArrayLike<number>
    const portY = topology.portY as unknown as ArrayLike<number>
    const portHCostToEndOfRoute = new Float64Array(
      topology.portCount * problem.routeCount,
    )
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

    return {
      portHCostToEndOfRoute,
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
  }

  resetCandidateBestCosts() {
    const { state } = this

    if (state.candidateBestCostGeneration === 0xffffffff) {
      state.candidateBestCostGenerationByHopId.fill(0)
      state.candidateBestCostGeneration = 1
      return
    }

    state.candidateBestCostGeneration += 1
  }

  getCandidateBestCost(hopId: HopId) {
    const { state } = this

    return state.candidateBestCostGenerationByHopId[hopId] ===
      state.candidateBestCostGeneration
      ? state.candidateBestCostByHopId[hopId]!
      : Number.POSITIVE_INFINITY
  }

  setCandidateBestCost(hopId: HopId, bestCost: number) {
    const { state } = this

    state.candidateBestCostGenerationByHopId[hopId] =
      state.candidateBestCostGeneration
    state.candidateBestCostByHopId[hopId] = bestCost
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

  protected canRewriteSolvedRoute(_routeId: RouteId): boolean {
    return true
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

  buildNextRegionIntersectionCache(
    regionCache: RegionIntersectionCache,
    regionId: RegionId,
    routeNetId: NetId,
    port1Id: PortId,
    port2Id: PortId,
  ): RegionIntersectionCache {
    const { topology } = this
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
      routeNetId,
      segmentGeometry.lesserAngle,
      segmentGeometry.greaterAngle,
      segmentGeometry.layerMask,
      segmentGeometry.entryExitLayerChanges,
    )
    const nextLength = regionCache.netIds.length + 1

    const netIds = new Int32Array(nextLength)
    netIds.set(regionCache.netIds)
    netIds[nextLength - 1] = routeNetId

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

    return {
      netIds,
      lesserAngles,
      greaterAngles,
      layerMasks,
      existingSameLayerIntersections,
      existingCrossingLayerIntersections,
      existingEntryExitLayerChanges,
      existingSegmentCount,
      existingRegionCost: computeRegionCost(
        topology.regionWidth[regionId],
        topology.regionHeight[regionId],
        existingSameLayerIntersections,
        existingCrossingLayerIntersections,
        existingEntryExitLayerChanges,
        existingSegmentCount,
        topology.regionAvailableZMask?.[regionId] ?? 0,
      ),
    }
  }

  appendSegmentToRegionCache(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ) {
    const { state } = this
    state.regionIntersectionCaches[regionId] =
      this.buildNextRegionIntersectionCache(
        state.regionIntersectionCaches[regionId]!,
        regionId,
        state.currentRouteNetId!,
        port1Id,
        port2Id,
      )
  }

  computeRegionIntersectionCacheFromSegments(
    regionId: RegionId,
    regionSegments: [RouteId, PortId, PortId][],
  ): RegionIntersectionCache {
    let regionCache = createEmptyRegionIntersectionCache()

    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      regionCache = this.buildNextRegionIntersectionCache(
        regionCache,
        regionId,
        this.problem.routeNet[routeId]!,
        fromPortId,
        toPortId,
      )
    }

    return regionCache
  }

  getSolvedPathSegments(finalCandidate: Candidate): SolvedRouteSegment[] {
    const { state } = this
    const candidatePath: Candidate[] = []
    let cursor: Candidate | undefined = finalCandidate

    while (cursor) {
      candidatePath.unshift(cursor)
      cursor = cursor.prevCandidate
    }

    const solvedSegments: SolvedRouteSegment[] = []

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

  getOrderedRoutePathFromRegionSegments(
    routeId: RouteId,
    regionSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
  ): OrderedRoutePath | null {
    const routeSegments: SolvedRouteSegment[] = []

    for (
      let regionId = 0;
      regionId < regionSegmentsByRegion.length;
      regionId++
    ) {
      for (const [
        segmentRouteId,
        fromPortId,
        toPortId,
      ] of regionSegmentsByRegion[regionId] ?? []) {
        if (segmentRouteId !== routeId) {
          continue
        }

        routeSegments.push({
          regionId,
          fromPortId,
          toPortId,
        })
      }
    }

    const startPortId = this.problem.routeStartPort[routeId]
    const endPortId = this.problem.routeEndPort[routeId]

    if (routeSegments.length === 0) {
      return startPortId === endPortId
        ? {
            orderedPortIds: [startPortId],
            orderedRegionIds: [],
          }
        : null
    }

    const segmentsByPort = new Map<
      PortId,
      Array<{
        segmentIndex: number
        regionId: RegionId
        fromPortId: PortId
        toPortId: PortId
      }>
    >()

    routeSegments.forEach((routeSegment, segmentIndex) => {
      const indexedSegment = {
        segmentIndex,
        ...routeSegment,
      }

      const fromPortSegments = segmentsByPort.get(routeSegment.fromPortId) ?? []
      fromPortSegments.push(indexedSegment)
      segmentsByPort.set(routeSegment.fromPortId, fromPortSegments)

      const toPortSegments = segmentsByPort.get(routeSegment.toPortId) ?? []
      toPortSegments.push(indexedSegment)
      segmentsByPort.set(routeSegment.toPortId, toPortSegments)
    })

    const orderedPortIds = [startPortId]
    const orderedRegionIds: RegionId[] = []
    const usedSegmentIndices = new Set<number>()
    let currentPortId = startPortId
    let previousPortId: PortId | undefined

    while (currentPortId !== endPortId) {
      const nextSegments = (segmentsByPort.get(currentPortId) ?? []).filter(
        ({ segmentIndex, fromPortId, toPortId }) => {
          if (usedSegmentIndices.has(segmentIndex)) {
            return false
          }

          const nextPortId =
            fromPortId === currentPortId ? toPortId : fromPortId
          return nextPortId !== previousPortId
        },
      )

      if (nextSegments.length !== 1) {
        return null
      }

      const nextSegment = nextSegments[0]!
      const nextPortId =
        nextSegment.fromPortId === currentPortId
          ? nextSegment.toPortId
          : nextSegment.fromPortId

      usedSegmentIndices.add(nextSegment.segmentIndex)
      orderedRegionIds.push(nextSegment.regionId)
      orderedPortIds.push(nextPortId)
      previousPortId = currentPortId
      currentPortId = nextPortId
    }

    return usedSegmentIndices.size === routeSegments.length
      ? {
          orderedPortIds,
          orderedRegionIds,
        }
      : null
  }

  getRoutePortTraversalsFromOrderedPath(
    routeId: RouteId,
    orderedRoutePath: OrderedRoutePath,
  ): RoutePortTraversal[] {
    const traversals: RoutePortTraversal[] = []

    for (
      let portIndex = 1;
      portIndex < orderedRoutePath.orderedPortIds.length - 1;
      portIndex++
    ) {
      const portId = orderedRoutePath.orderedPortIds[portIndex]!
      const previousPortId = orderedRoutePath.orderedPortIds[portIndex - 1]!
      const nextPortId = orderedRoutePath.orderedPortIds[portIndex + 1]!
      const previousRegionId = orderedRoutePath.orderedRegionIds[portIndex - 1]!
      const nextRegionId = orderedRoutePath.orderedRegionIds[portIndex]!
      const incidentRegionIds = this.topology.incidentPortRegion[portId] ?? []
      const regionId1 = incidentRegionIds[0]
      const regionId2 = incidentRegionIds[1]

      if (regionId1 === undefined || regionId2 === undefined) {
        continue
      }

      if (regionId1 === previousRegionId && regionId2 === nextRegionId) {
        traversals.push({
          routeId,
          portId,
          regionId1,
          regionId2,
          otherPortIdInRegion1: previousPortId,
          otherPortIdInRegion2: nextPortId,
          edgeKey: getRegionPairKey(regionId1, regionId2),
        })
        continue
      }

      if (regionId1 === nextRegionId && regionId2 === previousRegionId) {
        traversals.push({
          routeId,
          portId,
          regionId1,
          regionId2,
          otherPortIdInRegion1: nextPortId,
          otherPortIdInRegion2: previousPortId,
          edgeKey: getRegionPairKey(regionId1, regionId2),
        })
      }
    }

    return traversals
  }

  getRoutePortTraversalsFromSolvedSegments(
    routeId: RouteId,
    solvedSegments: SolvedRouteSegment[],
  ): RoutePortTraversal[] {
    const traversals: RoutePortTraversal[] = []

    for (
      let segmentIndex = 0;
      segmentIndex < solvedSegments.length - 1;
      segmentIndex++
    ) {
      const leftSegment = solvedSegments[segmentIndex]!
      const rightSegment = solvedSegments[segmentIndex + 1]!

      if (leftSegment.toPortId !== rightSegment.fromPortId) {
        continue
      }

      const portId = leftSegment.toPortId
      const incidentRegionIds = this.topology.incidentPortRegion[portId] ?? []
      const regionId1 = incidentRegionIds[0]
      const regionId2 = incidentRegionIds[1]

      if (regionId1 === undefined || regionId2 === undefined) {
        continue
      }

      if (
        regionId1 === leftSegment.regionId &&
        regionId2 === rightSegment.regionId
      ) {
        traversals.push({
          routeId,
          portId,
          regionId1,
          regionId2,
          otherPortIdInRegion1: leftSegment.fromPortId,
          otherPortIdInRegion2: rightSegment.toPortId,
          edgeKey: getRegionPairKey(regionId1, regionId2),
          solvedSegmentIndex: segmentIndex,
        })
        continue
      }

      if (
        regionId1 === rightSegment.regionId &&
        regionId2 === leftSegment.regionId
      ) {
        traversals.push({
          routeId,
          portId,
          regionId1,
          regionId2,
          otherPortIdInRegion1: rightSegment.toPortId,
          otherPortIdInRegion2: leftSegment.fromPortId,
          edgeKey: getRegionPairKey(regionId1, regionId2),
          solvedSegmentIndex: segmentIndex,
        })
      }
    }

    return traversals
  }

  getOtherPortIdForTraversalRegion(
    traversal: RoutePortTraversal,
    regionId: RegionId,
  ): PortId | undefined {
    if (traversal.regionId1 === regionId) {
      return traversal.otherPortIdInRegion1
    }

    if (traversal.regionId2 === regionId) {
      return traversal.otherPortIdInRegion2
    }

    return undefined
  }

  replacePortInRouteSegment(
    regionSegments: [RouteId, PortId, PortId][],
    routeId: RouteId,
    otherPortId: PortId,
    oldPortId: PortId,
    newPortId: PortId,
  ): boolean {
    for (
      let segmentIndex = 0;
      segmentIndex < regionSegments.length;
      segmentIndex++
    ) {
      const [segmentRouteId, port1Id, port2Id] = regionSegments[segmentIndex]!

      if (segmentRouteId !== routeId) {
        continue
      }

      const matchesSegment =
        (port1Id === otherPortId && port2Id === oldPortId) ||
        (port1Id === oldPortId && port2Id === otherPortId)

      if (!matchesSegment) {
        continue
      }

      regionSegments[segmentIndex] = [
        routeId,
        port1Id === oldPortId ? newPortId : port1Id,
        port2Id === oldPortId ? newPortId : port2Id,
      ]
      return true
    }

    return false
  }

  isPortCompatibleWithRouteNet(routeId: RouteId, portId: PortId): boolean {
    const routeNetId = this.problem.routeNet[routeId]
    const reservedNetIds = this.problemSetup.portEndpointNetIds[portId]

    if (!reservedNetIds) {
      return true
    }

    for (const netId of reservedNetIds) {
      if (netId !== routeNetId) {
        return false
      }
    }

    return true
  }

  isPortUsableByRouteAfterSwap(
    routeId: RouteId,
    portId: PortId,
    regionSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
    ignoredRouteIds: RouteId[],
  ): boolean {
    if (!this.isPortCompatibleWithRouteNet(routeId, portId)) {
      return false
    }

    const ignoredRouteIdSet = new Set(ignoredRouteIds)
    const routeNetId = this.problem.routeNet[routeId]

    for (const regionSegments of regionSegmentsByRegion) {
      for (const [segmentRouteId, port1Id, port2Id] of regionSegments) {
        if (ignoredRouteIdSet.has(segmentRouteId)) {
          continue
        }

        if (port1Id !== portId && port2Id !== portId) {
          continue
        }

        if (this.problem.routeNet[segmentRouteId] !== routeNetId) {
          return false
        }
      }
    }

    return true
  }

  rebuildPortAssignmentsFromRegionSegments() {
    const { state } = this
    state.portAssignment.fill(-1)

    for (const regionSegments of state.regionSegments) {
      for (const [routeId, port1Id, port2Id] of regionSegments) {
        const routeNetId = this.problem.routeNet[routeId]
        state.portAssignment[port1Id] = routeNetId
        state.portAssignment[port2Id] = routeNetId
      }
    }
  }

  tryCreateImprovingPortSwap(
    currentTraversal: RoutePortTraversal,
    otherTraversal: RoutePortTraversal,
    currentRoutePortIds: Set<PortId>,
    otherRoutePortIds: Set<PortId>,
    regionSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
    regionIntersectionCaches: RegionIntersectionCache[],
  ):
    | {
        affectedRegionIds: RegionId[]
        candidateRegionSegmentsById: Map<RegionId, [RouteId, PortId, PortId][]>
        candidateRegionCachesById: Map<RegionId, RegionIntersectionCache>
      }
    | undefined {
    if (currentTraversal.portId === otherTraversal.portId) {
      return
    }

    if (
      currentRoutePortIds.has(otherTraversal.portId) ||
      otherRoutePortIds.has(currentTraversal.portId)
    ) {
      return
    }

    if (
      !this.isPortUsableByRouteAfterSwap(
        currentTraversal.routeId,
        otherTraversal.portId,
        regionSegmentsByRegion,
        [otherTraversal.routeId],
      ) ||
      !this.isPortUsableByRouteAfterSwap(
        otherTraversal.routeId,
        currentTraversal.portId,
        regionSegmentsByRegion,
        [currentTraversal.routeId],
      )
    ) {
      return
    }

    const affectedRegionIds = [
      ...new Set([
        currentTraversal.regionId1,
        currentTraversal.regionId2,
        otherTraversal.regionId1,
        otherTraversal.regionId2,
      ]),
    ]
    const candidateRegionSegmentsById = new Map<
      RegionId,
      [RouteId, PortId, PortId][]
    >(
      affectedRegionIds.map((regionId) => [
        regionId,
        regionSegmentsByRegion[regionId]!.map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
        ),
      ]),
    )

    for (const regionId of affectedRegionIds) {
      const currentOtherPortId = this.getOtherPortIdForTraversalRegion(
        currentTraversal,
        regionId,
      )
      const otherOtherPortId = this.getOtherPortIdForTraversalRegion(
        otherTraversal,
        regionId,
      )

      if (
        currentOtherPortId === undefined ||
        otherOtherPortId === undefined ||
        currentOtherPortId === otherTraversal.portId ||
        otherOtherPortId === currentTraversal.portId
      ) {
        return
      }

      const candidateRegionSegments = candidateRegionSegmentsById.get(regionId)
      if (
        !candidateRegionSegments ||
        !this.replacePortInRouteSegment(
          candidateRegionSegments,
          currentTraversal.routeId,
          currentOtherPortId,
          currentTraversal.portId,
          otherTraversal.portId,
        ) ||
        !this.replacePortInRouteSegment(
          candidateRegionSegments,
          otherTraversal.routeId,
          otherOtherPortId,
          otherTraversal.portId,
          currentTraversal.portId,
        )
      ) {
        return
      }
    }

    const currentSummary = summarizeRegionCostsForRegionIds(
      affectedRegionIds,
      (regionId) => regionIntersectionCaches[regionId],
    )
    const candidateRegionCachesById = new Map<
      RegionId,
      RegionIntersectionCache
    >(
      affectedRegionIds.map((regionId) => [
        regionId,
        this.computeRegionIntersectionCacheFromSegments(
          regionId,
          candidateRegionSegmentsById.get(regionId)!,
        ),
      ]),
    )
    const candidateSummary = summarizeRegionCostsForRegionIds(
      affectedRegionIds,
      (regionId) => candidateRegionCachesById.get(regionId),
    )

    return compareRegionCostSummaries(candidateSummary, currentSummary) < 0
      ? {
          affectedRegionIds,
          candidateRegionSegmentsById,
          candidateRegionCachesById,
        }
      : undefined
  }

  untangleRecentlySolvedRoute(
    currentRouteId: RouteId,
    solvedSegments: SolvedRouteSegment[],
  ): {
    regionSegmentsByRegion: Array<[RouteId, PortId, PortId][]>
    regionIntersectionCaches: RegionIntersectionCache[]
    dirtyRegionIds: Set<RegionId>
    acceptedSwapCount: number
  } {
    const { state } = this
    const workingRegionSegments = cloneRegionSegments(state.regionSegments)
    const workingRegionIntersectionCaches = state.regionIntersectionCaches.map(
      cloneRegionIntersectionCache,
    )
    const dirtyRegionIds = new Set<RegionId>()
    const mutableSolvedSegments = solvedSegments.map((segment) => ({
      ...segment,
    }))

    for (const { regionId, fromPortId, toPortId } of mutableSolvedSegments) {
      workingRegionSegments[regionId]!.push([
        currentRouteId,
        fromPortId,
        toPortId,
      ])
      workingRegionIntersectionCaches[regionId] =
        this.buildNextRegionIntersectionCache(
          workingRegionIntersectionCaches[regionId]!,
          regionId,
          state.currentRouteNetId!,
          fromPortId,
          toPortId,
        )
      dirtyRegionIds.add(regionId)
    }

    let acceptedSwapCount = 0

    while (true) {
      const currentRoutePath = this.getOrderedRoutePathFromRegionSegments(
        currentRouteId,
        workingRegionSegments,
      )
      if (!currentRoutePath) {
        break
      }

      const currentRoutePortIds = new Set(currentRoutePath.orderedPortIds)
      const currentTraversals = this.getRoutePortTraversalsFromSolvedSegments(
        currentRouteId,
        mutableSolvedSegments,
      )
      const otherRouteContextByRouteId = new Map<
        RouteId,
        {
          portIds: Set<PortId>
          traversals: RoutePortTraversal[]
        }
      >()
      let appliedSwap = false

      for (const currentTraversal of currentTraversals) {
        const currentRegionCost1 =
          workingRegionIntersectionCaches[currentTraversal.regionId1]
            ?.existingRegionCost ?? 0
        const currentRegionCost2 =
          workingRegionIntersectionCaches[currentTraversal.regionId2]
            ?.existingRegionCost ?? 0

        if (
          currentRegionCost1 <= IMPROVEMENT_EPSILON &&
          currentRegionCost2 <= IMPROVEMENT_EPSILON
        ) {
          continue
        }

        const routeIdsInRegion1 = new Set(
          workingRegionSegments[currentTraversal.regionId1]!.map(
            ([routeId]) => routeId,
          ),
        )
        const candidateRouteIds = new Set<RouteId>()

        for (const [routeId] of workingRegionSegments[
          currentTraversal.regionId2
        ]!) {
          if (
            routeId === currentRouteId ||
            !routeIdsInRegion1.has(routeId) ||
            !this.canRewriteSolvedRoute(routeId)
          ) {
            continue
          }

          candidateRouteIds.add(routeId)
        }

        for (const otherRouteId of candidateRouteIds) {
          let otherRouteContext = otherRouteContextByRouteId.get(otherRouteId)

          if (!otherRouteContext) {
            const otherRoutePath = this.getOrderedRoutePathFromRegionSegments(
              otherRouteId,
              workingRegionSegments,
            )
            if (!otherRoutePath) {
              continue
            }

            otherRouteContext = {
              portIds: new Set(otherRoutePath.orderedPortIds),
              traversals: this.getRoutePortTraversalsFromOrderedPath(
                otherRouteId,
                otherRoutePath,
              ),
            }
            otherRouteContextByRouteId.set(otherRouteId, otherRouteContext)
          }

          for (const otherTraversal of otherRouteContext.traversals) {
            if (otherTraversal.edgeKey !== currentTraversal.edgeKey) {
              continue
            }

            const swapResult = this.tryCreateImprovingPortSwap(
              currentTraversal,
              otherTraversal,
              currentRoutePortIds,
              otherRouteContext.portIds,
              workingRegionSegments,
              workingRegionIntersectionCaches,
            )

            if (!swapResult) {
              continue
            }

            for (const regionId of swapResult.affectedRegionIds) {
              workingRegionSegments[regionId] =
                swapResult.candidateRegionSegmentsById.get(regionId)!
              workingRegionIntersectionCaches[regionId] =
                swapResult.candidateRegionCachesById.get(regionId)!
              dirtyRegionIds.add(regionId)
            }

            if (currentTraversal.solvedSegmentIndex !== undefined) {
              const leftSolvedSegment =
                mutableSolvedSegments[currentTraversal.solvedSegmentIndex]
              const rightSolvedSegment =
                mutableSolvedSegments[currentTraversal.solvedSegmentIndex + 1]

              if (leftSolvedSegment && rightSolvedSegment) {
                leftSolvedSegment.toPortId = otherTraversal.portId
                rightSolvedSegment.fromPortId = otherTraversal.portId
              }
            }

            acceptedSwapCount += 1
            appliedSwap = true
            break
          }

          if (appliedSwap) {
            break
          }
        }

        if (appliedSwap) {
          break
        }
      }

      if (!appliedSwap) {
        break
      }
    }

    return {
      regionSegmentsByRegion: workingRegionSegments,
      regionIntersectionCaches: workingRegionIntersectionCaches,
      dirtyRegionIds,
      acceptedSwapCount,
    }
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

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)

      if (regionCost > currentRipThreshold) {
        regionIdsOverCostThreshold.push(regionId)
      }
    }

    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: regionIdsOverCostThreshold.length,
      maxRegionCost,
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

    const solvedSegments = this.getSolvedPathSegments(finalCandidate)
    const untangledRoute = this.untangleRecentlySolvedRoute(
      currentRouteId,
      solvedSegments,
    )

    for (const regionId of untangledRoute.dirtyRegionIds) {
      state.regionSegments[regionId] =
        untangledRoute.regionSegmentsByRegion[regionId]!
      state.regionIntersectionCaches[regionId] =
        untangledRoute.regionIntersectionCaches[regionId]!
    }
    this.rebuildPortAssignmentsFromRegionSegments()
    this.stats = {
      ...this.stats,
      untangleAcceptedSwapCount:
        (this.stats.untangleAcceptedSwapCount ?? 0) +
        untangledRoute.acceptedSwapCount,
    }

    state.candidateQueue.clear()
    state.currentRouteNetId = undefined
    state.currentRouteId = undefined
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const { topology, state } = this

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
      computeRegionCost(
        topology.regionWidth[nextRegionId],
        topology.regionHeight[nextRegionId],
        regionCache.existingSameLayerIntersections + newSameLayerIntersections,
        regionCache.existingCrossingLayerIntersections +
          newCrossLayerIntersections,
        regionCache.existingEntryExitLayerChanges + newEntryExitLayerChanges,
        regionCache.existingSegmentCount + 1,
        topology.regionAvailableZMask?.[nextRegionId] ?? 0,
      ) - regionCache.existingRegionCost

    return (
      currentCandidate.g +
      newRegionCost +
      state.regionCongestionCost[nextRegionId]
    )
  }

  override tryFinalAcceptance() {
    const neverSuccessfullyRoutedRoutes =
      this.getNeverSuccessfullyRoutedRoutes()

    this.stats = {
      ...this.stats,
      neverSuccessfullyRoutedRouteCount: neverSuccessfullyRoutedRoutes.length,
    }
    this.logNeverSuccessfullyRoutedRoutes()
  }

  computeH(neighborPortId: PortId): number {
    return this.problemSetup.portHCostToEndOfRoute[
      neighborPortId * this.problem.routeCount + this.state.currentRouteId!
    ]
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this)
  }

  override getOutput() {
    return convertToSerializedHyperGraph(this)
  }
}
