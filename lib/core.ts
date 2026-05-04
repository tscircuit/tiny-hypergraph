import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import {
  DEFAULT_MIN_VIA_PAD_DIAMETER,
  computeRegionCost,
  isKnownSingleLayerMask,
} from "./computeRegionCost"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import { MinHeap } from "./MinHeap"
import {
  getMaxFlowImpossibilityError,
  getRouteMaxFlow,
  getMaxFlowUnroutableRoutes,
} from "./max-flow-impossibility"
import {
  createRegionGraph,
  createRegionPathProblem,
} from "./region-graph/graph"
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

interface CompleteRoutingSnapshot {
  maxRegionCost: number
  totalRegionCost: number
  ripCount: number
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
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
  goalConnectedPortMask: Int8Array | undefined
  startConnectedPortMask: Int8Array | undefined

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
  MAX_ITERATIONS?: number
  VERBOSE?: boolean
  STATIC_REACHABILITY_PRECHECK?: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS?: number
  MAX_FLOW_IMPOSSIBILITY_CHECK?: boolean
}

export interface TinyHyperGraphSolverOptionTarget {
  minViaPadDiameter: number
  DISTANCE_TO_COST: number
  RIP_THRESHOLD_START: number
  RIP_THRESHOLD_END: number
  RIP_THRESHOLD_RAMP_ATTEMPTS: number
  RIP_CONGESTION_REGION_COST_FACTOR: number
  MAX_ITERATIONS: number
  VERBOSE: boolean
  STATIC_REACHABILITY_PRECHECK: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS: number
  MAX_FLOW_IMPOSSIBILITY_CHECK: boolean
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
  if (options.MAX_FLOW_IMPOSSIBILITY_CHECK !== undefined) {
    solver.MAX_FLOW_IMPOSSIBILITY_CHECK = options.MAX_FLOW_IMPOSSIBILITY_CHECK
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
  MAX_ITERATIONS: solver.MAX_ITERATIONS,
  VERBOSE: solver.VERBOSE,
  STATIC_REACHABILITY_PRECHECK: solver.STATIC_REACHABILITY_PRECHECK,
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS:
    solver.STATIC_REACHABILITY_PRECHECK_MAX_HOPS,
  MAX_FLOW_IMPOSSIBILITY_CHECK: solver.MAX_FLOW_IMPOSSIBILITY_CHECK,
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
  private _endpointPointIdByPortId?: Array<string | undefined>
  private bestCompleteRoutingSnapshot?: CompleteRoutingSnapshot
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
  minViaPadDiameter = DEFAULT_MIN_VIA_PAD_DIAMETER

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1

  override MAX_ITERATIONS = 1e6
  VERBOSE = false
  STATIC_REACHABILITY_PRECHECK = true
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS = 16
  MAX_FLOW_IMPOSSIBILITY_CHECK = false

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
      goalConnectedPortMask: undefined,
      startConnectedPortMask: undefined,
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

  get endpointPointIdByPortId(): Array<string | undefined> {
    if (this._endpointPointIdByPortId) {
      return this._endpointPointIdByPortId
    }

    const endpointPointIdByPortId = Array.from(
      { length: this.topology.portCount },
      () => undefined as string | undefined,
    )

    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const pointIds =
        this.getRouteMetadata(
          routeId,
        )?.simpleRouteConnection?.pointsToConnect?.map(({ pointId }) =>
          typeof pointId === "string" ? pointId : undefined,
        ) ?? []
      const startPointId = pointIds[0]
      const endPointId = pointIds[1]

      if (startPointId !== undefined) {
        endpointPointIdByPortId[this.problem.routeStartPort[routeId]!] =
          startPointId
      }
      if (endPointId !== undefined) {
        endpointPointIdByPortId[this.problem.routeEndPort[routeId]!] =
          endPointId
      }
    }

    this._endpointPointIdByPortId = endpointPointIdByPortId
    return endpointPointIdByPortId
  }

  override _setup() {
    void this.problemSetup

    if (this.STATIC_REACHABILITY_PRECHECK) {
      if (!this.MAX_FLOW_IMPOSSIBILITY_CHECK) {
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
        return
      }

      const maxFlowUnroutableRoutes = getMaxFlowUnroutableRoutes({
        topology: this.topology,
        problem: this.problem,
        problemSetup: this.problemSetup,
        portAssignment: this.state.portAssignment,
        routeIds: this.state.unroutedRoutes,
        regionIntersectionCaches: this.state.regionIntersectionCaches,
        getStartingNextRegionId: (routeId, startingPortId) =>
          this.getStartingNextRegionId(routeId, startingPortId),
        getRouteSummary: (routeId) => this.getRouteSummary(routeId),
      })
      if (maxFlowUnroutableRoutes.length > 0) {
        this.failed = true
        this.error = getMaxFlowImpossibilityError(maxFlowUnroutableRoutes)
        this.stats = {
          ...this.stats,
          maxFlowUnroutableRouteCount: maxFlowUnroutableRoutes.length,
          staticallyUnroutableRouteCount: maxFlowUnroutableRoutes.length,
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

      state.goalPortId = problem.routeEndPort[state.currentRouteId!]
      state.goalConnectedPortMask = this.createSameNetConnectedPortMask(
        state.goalPortId,
        state.currentRouteNetId!,
      )
      state.startConnectedPortMask = this.createSameNetConnectedPortMask(
        startingPortId,
        state.currentRouteNetId!,
      )

      for (let portId = 0; portId < topology.portCount; portId++) {
        if (state.startConnectedPortMask[portId] !== 1) continue

        const incidentRegions =
          portId === startingPortId
            ? [startingNextRegionId]
            : (topology.incidentPortRegion[portId] ?? [])

        for (const nextRegionId of incidentRegions) {
          if (
            nextRegionId === undefined ||
            this.isRegionReservedForDifferentNet(nextRegionId)
          ) {
            continue
          }

          const hopId = this.getHopId(portId, nextRegionId)
          this.setCandidateBestCost(hopId, 0)
          const h = this.computeH(portId)
          state.candidateQueue.queue({
            nextRegionId,
            portId,
            f: h,
            g: 0,
            h,
          })
        }
      }

      if (state.candidateQueue.length === 0) {
        this.failed = true
        this.error = `Start port ${startingPortId} has no legal starting regions`
        return
      }

      if (
        this.hasConnectedPortMaskOverlap(
          state.startConnectedPortMask,
          state.goalConnectedPortMask,
        )
      ) {
        this.onPathFound({
          nextRegionId: startingNextRegionId,
          portId: startingPortId,
          f: 0,
          g: 0,
          h: 0,
        })
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

      if (this.isRouteGoalPort(neighborPortId)) {
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

  isRouteGoalPort(portId: PortId): boolean {
    return (
      portId === this.state.goalPortId ||
      this.state.goalConnectedPortMask?.[portId] === 1
    )
  }

  createSameNetConnectedPortMask(
    anchorPortId: PortId,
    routeNetId: NetId,
  ): Int8Array {
    const { topology, problem, state } = this
    const mask = new Int8Array(topology.portCount)
    mask[anchorPortId] = 1

    if (state.portAssignment[anchorPortId] !== routeNetId) {
      return mask
    }

    const sameNetAdjacentPorts = Array.from(
      { length: topology.portCount },
      () => [] as PortId[],
    )
    const sameNetEndpointPortsByPointId = new Map<string, PortId[]>()

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      if (problem.routeNet[routeId] !== routeNetId) continue

      for (const portId of [
        problem.routeStartPort[routeId]!,
        problem.routeEndPort[routeId]!,
      ]) {
        const pointId = this.endpointPointIdByPortId[portId]
        if (pointId === undefined) continue

        const ports = sameNetEndpointPortsByPointId.get(pointId) ?? []
        ports.push(portId)
        sameNetEndpointPortsByPointId.set(pointId, ports)
      }
    }

    for (const ports of sameNetEndpointPortsByPointId.values()) {
      for (const portId of ports) {
        for (const otherPortId of ports) {
          if (otherPortId === portId) continue
          sameNetAdjacentPorts[portId]!.push(otherPortId)
        }
      }
    }

    for (const regionSegments of state.regionSegments) {
      for (const [segmentRouteId, fromPortId, toPortId] of regionSegments) {
        if (problem.routeNet[segmentRouteId] !== routeNetId) continue
        sameNetAdjacentPorts[fromPortId]!.push(toPortId)
        sameNetAdjacentPorts[toPortId]!.push(fromPortId)
      }
    }

    const queue = [anchorPortId]
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const portId = queue[queueIndex]!

      for (const nextPortId of sameNetAdjacentPorts[portId]!) {
        if (mask[nextPortId] === 1) continue
        if (
          nextPortId !== anchorPortId &&
          state.portAssignment[nextPortId] !== routeNetId
        ) {
          continue
        }
        mask[nextPortId] = 1
        queue.push(nextPortId)
      }
    }

    return mask
  }

  hasConnectedPortMaskOverlap(
    firstMask: Int8Array,
    secondMask: Int8Array,
  ): boolean {
    for (let portId = 0; portId < firstMask.length; portId++) {
      if (firstMask[portId] === 1 && secondMask[portId] === 1) {
        return true
      }
    }

    return false
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
    netId = this.state.currentRouteNetId!,
  ) {
    const { topology, state } = this
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
      netId,
      segmentGeometry.lesserAngle,
      segmentGeometry.greaterAngle,
      segmentGeometry.layerMask,
      segmentGeometry.entryExitLayerChanges,
    )
    const nextLength = regionCache.netIds.length + 1

    const netIds = new Int32Array(nextLength)
    netIds.set(regionCache.netIds)
    netIds[nextLength - 1] = netId

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
    if (lastCandidate && !this.isRouteGoalPort(lastCandidate.portId)) {
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
    state.goalConnectedPortMask = undefined
    state.startConnectedPortMask = undefined
  }

  private cloneRegionIntersectionCache(
    cache: RegionIntersectionCache,
  ): RegionIntersectionCache {
    return {
      netIds: new Int32Array(cache.netIds),
      lesserAngles: new Int32Array(cache.lesserAngles),
      greaterAngles: new Int32Array(cache.greaterAngles),
      layerMasks: new Int32Array(cache.layerMasks),
      existingCrossingLayerIntersections:
        cache.existingCrossingLayerIntersections,
      existingSameLayerIntersections: cache.existingSameLayerIntersections,
      existingEntryExitLayerChanges: cache.existingEntryExitLayerChanges,
      existingRegionCost: cache.existingRegionCost,
      existingSegmentCount: cache.existingSegmentCount,
    }
  }

  private saveBestCompleteRoutingSnapshot(
    maxRegionCost: number,
    totalRegionCost: number,
  ) {
    if (
      this.bestCompleteRoutingSnapshot &&
      maxRegionCost >= this.bestCompleteRoutingSnapshot.maxRegionCost
    ) {
      return
    }

    this.bestCompleteRoutingSnapshot = {
      maxRegionCost,
      totalRegionCost,
      ripCount: this.state.ripCount,
      portAssignment: new Int32Array(this.state.portAssignment),
      regionSegments: this.state.regionSegments.map((segments) =>
        segments.map(([routeId, fromPortId, toPortId]) => [
          routeId,
          fromPortId,
          toPortId,
        ]),
      ),
      regionIntersectionCaches: this.state.regionIntersectionCaches.map(
        (cache) => this.cloneRegionIntersectionCache(cache),
      ),
    }
  }

  private restoreBestCompleteRoutingSnapshot() {
    const snapshot = this.bestCompleteRoutingSnapshot
    if (!snapshot) {
      return false
    }

    this.state.portAssignment = new Int32Array(snapshot.portAssignment)
    this.state.regionSegments = snapshot.regionSegments.map((segments) =>
      segments.map(([routeId, fromPortId, toPortId]) => [
        routeId,
        fromPortId,
        toPortId,
      ]),
    )
    this.state.regionIntersectionCaches = snapshot.regionIntersectionCaches.map(
      (cache) => this.cloneRegionIntersectionCache(cache),
    )
    this.state.currentRouteNetId = undefined
    this.state.currentRouteId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    this.state.goalConnectedPortMask = undefined
    this.state.startConnectedPortMask = undefined
    this.state.ripCount = snapshot.ripCount
    this.solved = true
    this.failed = false
    this.error = null
    this.stats = {
      ...this.stats,
      acceptedBestCompleteRouting: true,
      maxRegionCost: snapshot.maxRegionCost,
      totalRegionCost: snapshot.totalRegionCost,
      ripCount: snapshot.ripCount,
    }

    return true
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

  private getEndpointDistance(routeId: RouteId) {
    const startPortId = this.problem.routeStartPort[routeId]!
    const endPortId = this.problem.routeEndPort[routeId]!
    return Math.hypot(
      this.topology.portX[startPortId] - this.topology.portX[endPortId],
      this.topology.portY[startPortId] - this.topology.portY[endPortId],
    )
  }

  private tryMaterializeRegionPathSolution() {
    const { topology, problem } = this
    const regionGraph = createRegionGraph(topology)
    const regionProblem = createRegionPathProblem(topology, problem)
    const edgeByPairKey = new Map<
      string,
      ReturnType<typeof createRegionGraph>["edges"][number]
    >()

    for (const edge of regionGraph.edges) {
      edgeByPairKey.set(
        edge.regionIdA < edge.regionIdB
          ? `${edge.regionIdA}:${edge.regionIdB}`
          : `${edge.regionIdB}:${edge.regionIdA}`,
        edge,
      )
    }

    const edgeNets = new Map<string, Set<NetId>>()
    const regionUsage = new Int32Array(topology.regionCount)
    const routeRegionPaths = Array.from(
      { length: problem.routeCount },
      () => [] as RegionId[],
    )
    const routeOrder = range(problem.routeCount).sort(
      (leftRouteId, rightRouteId) =>
        this.getEndpointDistance(rightRouteId) -
        this.getEndpointDistance(leftRouteId),
    )

    for (const routeId of routeOrder) {
      const routeNetId = problem.routeNet[routeId]!
      const startRegionId = regionProblem.routeStartRegion[routeId]!
      const goalRegionId = regionProblem.routeEndRegion[routeId]!
      const distanceByRegionId = new Float64Array(topology.regionCount).fill(
        Number.POSITIVE_INFINITY,
      )
      const previousRegionId = new Int32Array(topology.regionCount).fill(-1)
      const visitedRegionIds = new Uint8Array(topology.regionCount)
      distanceByRegionId[startRegionId] = 0

      for (;;) {
        let currentRegionId = -1
        let currentDistance = Number.POSITIVE_INFINITY
        for (let regionId = 0; regionId < topology.regionCount; regionId++) {
          if (
            visitedRegionIds[regionId] === 0 &&
            distanceByRegionId[regionId] < currentDistance
          ) {
            currentDistance = distanceByRegionId[regionId]
            currentRegionId = regionId
          }
        }

        if (currentRegionId === -1 || currentRegionId === goalRegionId) {
          break
        }

        visitedRegionIds[currentRegionId] = 1
        for (const edge of regionGraph.incidentEdges[currentRegionId] ?? []) {
          const nextRegionId =
            edge.regionIdA === currentRegionId ? edge.regionIdB : edge.regionIdA

          if (
            regionProblem.regionNetId[nextRegionId] !== -1 &&
            regionProblem.regionNetId[nextRegionId] !== routeNetId
          ) {
            continue
          }

          const edgeKey =
            currentRegionId < nextRegionId
              ? `${currentRegionId}:${nextRegionId}`
              : `${nextRegionId}:${currentRegionId}`
          const netsUsingEdge = edgeNets.get(edgeKey) ?? new Set<NetId>()
          const wouldUseNewPort = !netsUsingEdge.has(routeNetId)
          if (wouldUseNewPort && netsUsingEdge.size >= edge.portIds.length) {
            continue
          }

          const edgeCost =
            (wouldUseNewPort
              ? (netsUsingEdge.size + 1) / edge.portIds.length
              : 0.05 / edge.portIds.length) * 50
          const regionCapacity = Math.max(
            1e-6,
            topology.regionWidth[nextRegionId] *
              topology.regionHeight[nextRegionId],
          )
          const regionCost = (regionUsage[nextRegionId] + 1) / regionCapacity
          const nextDistance =
            distanceByRegionId[currentRegionId] + edgeCost + regionCost

          if (nextDistance < distanceByRegionId[nextRegionId]) {
            distanceByRegionId[nextRegionId] = nextDistance
            previousRegionId[nextRegionId] = currentRegionId
          }
        }
      }

      if (!Number.isFinite(distanceByRegionId[goalRegionId])) {
        return false
      }

      const regionPath: RegionId[] = []
      for (
        let regionId = goalRegionId;
        regionId !== -1;
        regionId = previousRegionId[regionId]!
      ) {
        regionPath.unshift(regionId)
      }
      routeRegionPaths[routeId] = regionPath

      for (const regionId of regionPath) {
        regionUsage[regionId] += 1
      }
      for (let i = 0; i < regionPath.length - 1; i++) {
        const regionIdA = regionPath[i]!
        const regionIdB = regionPath[i + 1]!
        const edgeKey =
          regionIdA < regionIdB
            ? `${regionIdA}:${regionIdB}`
            : `${regionIdB}:${regionIdA}`
        const netsUsingEdge = edgeNets.get(edgeKey) ?? new Set<NetId>()
        netsUsingEdge.add(routeNetId)
        edgeNets.set(edgeKey, netsUsingEdge)
      }
    }

    const assignedPortByEdgeNet = new Map<string, PortId>()
    for (const [edgeKey, netsUsingEdge] of edgeNets) {
      const edge = edgeByPairKey.get(edgeKey)
      if (!edge || netsUsingEdge.size > edge.portIds.length) {
        return false
      }

      let portIndex = 0
      for (const netId of netsUsingEdge) {
        assignedPortByEdgeNet.set(
          `${edgeKey}:${netId}`,
          edge.portIds[portIndex]!,
        )
        portIndex += 1
      }
    }

    this.state.portAssignment.fill(-1)
    this.state.regionSegments = Array.from(
      { length: topology.regionCount },
      () => [],
    )
    this.state.regionIntersectionCaches = Array.from(
      { length: topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )

    for (const routeId of routeOrder) {
      const routeNetId = problem.routeNet[routeId]!
      const regionPath = routeRegionPaths[routeId]!
      const portPath: PortId[] = [problem.routeStartPort[routeId]!]

      for (let i = 0; i < regionPath.length - 1; i++) {
        const regionIdA = regionPath[i]!
        const regionIdB = regionPath[i + 1]!
        const edgeKey =
          regionIdA < regionIdB
            ? `${regionIdA}:${regionIdB}`
            : `${regionIdB}:${regionIdA}`
        const portId = assignedPortByEdgeNet.get(`${edgeKey}:${routeNetId}`)
        if (portId === undefined) {
          return false
        }
        portPath.push(portId)
      }
      portPath.push(problem.routeEndPort[routeId]!)

      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = routeNetId

      for (let i = 0; i < portPath.length - 1; i++) {
        const regionId = regionPath[Math.min(i, regionPath.length - 1)]!
        const fromPortId = portPath[i]!
        const toPortId = portPath[i + 1]!
        const fromAssignedNetId = this.state.portAssignment[fromPortId]
        const toAssignedNetId = this.state.portAssignment[toPortId]
        if (
          (fromAssignedNetId !== -1 && fromAssignedNetId !== routeNetId) ||
          (toAssignedNetId !== -1 && toAssignedNetId !== routeNetId)
        ) {
          return false
        }

        this.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        this.state.portAssignment[fromPortId] = routeNetId
        this.state.portAssignment[toPortId] = routeNetId
        this.appendSegmentToRegionCache(
          regionId,
          fromPortId,
          toPortId,
          routeNetId,
        )
      }
    }

    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    this.state.goalConnectedPortMask = undefined
    this.state.startConnectedPortMask = undefined
    this.solved = true
    this.failed = false
    this.error = null

    let maxRegionCost = 0
    let totalRegionCost = 0
    for (const regionCache of this.state.regionIntersectionCaches) {
      maxRegionCost = Math.max(maxRegionCost, regionCache.existingRegionCost)
      totalRegionCost += regionCache.existingRegionCost
    }
    this.stats = {
      ...this.stats,
      acceptedRegionPathMaterialization: true,
      maxRegionCost,
      totalRegionCost,
    }

    return true
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

    this.saveBestCompleteRoutingSnapshot(maxRegionCost, totalRegionCost)

    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: regionIdsOverCostThreshold.length,
      maxRegionCost,
      totalRegionCost,
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
    const maxFlowBeforeRip =
      currentRouteId === undefined
        ? null
        : getRouteMaxFlow(
            {
              topology: this.topology,
              problem: this.problem,
              problemSetup: this.problemSetup,
              portAssignment: state.portAssignment,
              routeIds: [currentRouteId],
              regionIntersectionCaches: state.regionIntersectionCaches,
              getStartingNextRegionId: (routeId, startingPortId) =>
                this.getStartingNextRegionId(routeId, startingPortId),
              getRouteSummary: (routeId) => this.getRouteSummary(routeId),
            },
            currentRouteId,
            1,
          )

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
      ...(maxFlowBeforeRip === null
        ? {}
        : {
            maxFlowBeforeRip,
            maxFlowImpossibleBeforeRip: maxFlowBeforeRip < 1,
          }),
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
    state.goalConnectedPortMask = undefined
    state.startConnectedPortMask = undefined
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

    if (this.restoreBestCompleteRoutingSnapshot()) {
      return
    }

    this.tryMaterializeRegionPathSolution()
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
