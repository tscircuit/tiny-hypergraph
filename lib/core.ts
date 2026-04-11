import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import { computeRegionCost, isKnownSingleLayerMask } from "./computeRegionCost"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import { MinHeap } from "./MinHeap"
import { shuffle } from "./shuffle"
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

export interface TinyHyperGraphSolverOptions {
  DISTANCE_TO_COST?: number
  TRAVEL_DISTANCE_TO_COST?: number
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR?: number
  RIP_THRESHOLD_START?: number
  RIP_THRESHOLD_END?: number
  RIP_THRESHOLD_RAMP_ATTEMPTS?: number
  RIP_CONGESTION_REGION_COST_FACTOR?: number
  MAX_ITERATIONS?: number
}

export interface TinyHyperGraphSolverOptionTarget {
  DISTANCE_TO_COST: number
  TRAVEL_DISTANCE_TO_COST: number
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: number
  RIP_THRESHOLD_START: number
  RIP_THRESHOLD_END: number
  RIP_THRESHOLD_RAMP_ATTEMPTS: number
  RIP_CONGESTION_REGION_COST_FACTOR: number
  MAX_ITERATIONS: number
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
  /**
   * Optional alternate endpoint candidates for routes that can legally enter or
   * exit through several nearby ports, such as buses.
   */
  routeStartPortCandidates?: Array<PortId[] | undefined>
  routeEndPortCandidates?: Array<PortId[] | undefined>

  // routeNet[routeId] = net id of the route
  routeNet: Int32Array // NetId[]
  /** regionNetId[regionId] = reserved net id for the region, -1 means freely traversable */
  regionNetId: Int32Array
  /**
   * Suggested solver tuning recovered from upstream serialized inputs.
   * The core solver applies these defaults before explicit constructor options.
   */
  suggestedSolverOptions?: TinyHyperGraphSolverOptions
}

export interface TinyHyperGraphProblemSetup {
  // portHCostToEndOfRoute[portId * routeCount + routeId] = distance from port to end of route
  portHCostToEndOfRoute: Float64Array
  portEndpointNetIds: Array<Set<NetId>>
  routeStartPortCandidates: PortId[][]
  routeEndPortCandidates: PortId[][]
  routeEndPortCandidateSets: Array<Set<PortId>>
  routeStraightLineDx: Float64Array
  routeStraightLineDy: Float64Array
  routeStraightLineConstant: Float64Array
  routeStraightLineLength: Float64Array
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
  // portAssignedRouteId[portId] = RouteId, -1 means no currently routed owner
  portAssignedRouteId: Int32Array

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
  if (options.TRAVEL_DISTANCE_TO_COST !== undefined) {
    solver.TRAVEL_DISTANCE_TO_COST = options.TRAVEL_DISTANCE_TO_COST
  }
  if (options.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR !== undefined) {
    solver.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR =
      options.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR
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
}

export const getTinyHyperGraphSolverOptions = (
  solver: TinyHyperGraphSolverOptionTarget,
): TinyHyperGraphSolverOptions => ({
  DISTANCE_TO_COST: solver.DISTANCE_TO_COST,
  TRAVEL_DISTANCE_TO_COST: solver.TRAVEL_DISTANCE_TO_COST,
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR:
    solver.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR,
  RIP_THRESHOLD_START: solver.RIP_THRESHOLD_START,
  RIP_THRESHOLD_END: solver.RIP_THRESHOLD_END,
  RIP_THRESHOLD_RAMP_ATTEMPTS: solver.RIP_THRESHOLD_RAMP_ATTEMPTS,
  RIP_CONGESTION_REGION_COST_FACTOR: solver.RIP_CONGESTION_REGION_COST_FACTOR,
  MAX_ITERATIONS: solver.MAX_ITERATIONS,
})

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f

const normalizeRoutePortCandidates = (
  candidatePortIds: ReadonlyArray<PortId> | undefined,
  fallbackPortId: PortId,
): PortId[] => {
  const normalizedCandidates: PortId[] = []
  const seenPortIds = new Set<PortId>()

  for (const portId of candidatePortIds ?? []) {
    if (seenPortIds.has(portId)) {
      continue
    }

    seenPortIds.add(portId)
    normalizedCandidates.push(portId)
  }

  if (!seenPortIds.has(fallbackPortId)) {
    normalizedCandidates.push(fallbackPortId)
  }

  return normalizedCandidates
}

interface SegmentGeometryScratch {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  private _problemSetup?: TinyHyperGraphProblemSetup
  private currentRouteBlockedRouteHits = new Map<RouteId, number>()
  private segmentGeometryScratch: SegmentGeometryScratch = {
    lesserAngle: 0,
    greaterAngle: 0,
    layerMask: 0,
    entryExitLayerChanges: 0,
  }

  DISTANCE_TO_COST = 0.05 // 50mm = 1 cost unit (1 cost unit ~ 100% chance of failure)
  TRAVEL_DISTANCE_TO_COST = 0.002
  STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR = 0

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1

  override MAX_ITERATIONS = 1e6

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super()
    applyTinyHyperGraphSolverOptions(this, problem.suggestedSolverOptions)
    applyTinyHyperGraphSolverOptions(this, options)
    this.state = {
      portAssignment: new Int32Array(topology.portCount).fill(-1),
      portAssignedRouteId: new Int32Array(topology.portCount).fill(-1),
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
    const routeStartPortCandidates = Array.from(
      { length: problem.routeCount },
      () => [] as PortId[],
    )
    const routeEndPortCandidates = Array.from(
      { length: problem.routeCount },
      () => [] as PortId[],
    )
    const routeEndPortCandidateSets = Array.from(
      { length: problem.routeCount },
      () => new Set<PortId>(),
    )
    const routeStraightLineDx = new Float64Array(problem.routeCount)
    const routeStraightLineDy = new Float64Array(problem.routeCount)
    const routeStraightLineConstant = new Float64Array(problem.routeCount)
    const routeStraightLineLength = new Float64Array(problem.routeCount)

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      const startPortId = problem.routeStartPort[routeId]
      const endPortId = problem.routeEndPort[routeId]
      const startPortCandidateIds = normalizeRoutePortCandidates(
        problem.routeStartPortCandidates?.[routeId],
        startPortId,
      )
      const endPortCandidateIds = normalizeRoutePortCandidates(
        problem.routeEndPortCandidates?.[routeId],
        endPortId,
      )
      const startX = portX[startPortId]
      const startY = portY[startPortId]
      const endX = portX[endPortId]
      const endY = portY[endPortId]

      routeStartPortCandidates[routeId] = startPortCandidateIds
      routeEndPortCandidates[routeId] = endPortCandidateIds
      routeEndPortCandidateSets[routeId] = new Set(endPortCandidateIds)

      portEndpointNetIds[startPortId]!.add(problem.routeNet[routeId])
      portEndpointNetIds[endPortId]!.add(problem.routeNet[routeId])
      routeStraightLineDx[routeId] = endX - startX
      routeStraightLineDy[routeId] = endY - startY
      routeStraightLineConstant[routeId] = endX * startY - endY * startX
      routeStraightLineLength[routeId] = Math.hypot(
        routeStraightLineDx[routeId]!,
        routeStraightLineDy[routeId]!,
      )

      for (let portId = 0; portId < topology.portCount; portId++) {
        let minDistanceToGoal = Number.POSITIVE_INFINITY

        for (const candidateEndPortId of endPortCandidateIds) {
          const dx = portX[portId] - portX[candidateEndPortId]
          const dy = portY[portId] - portY[candidateEndPortId]
          minDistanceToGoal = Math.min(minDistanceToGoal, Math.hypot(dx, dy))
        }

        portHCostToEndOfRoute[portId * problem.routeCount + routeId] =
          minDistanceToGoal * this.DISTANCE_TO_COST
      }
    }

    return {
      portHCostToEndOfRoute,
      portEndpointNetIds,
      routeStartPortCandidates,
      routeEndPortCandidates,
      routeEndPortCandidateSets,
      routeStraightLineDx,
      routeStraightLineDy,
      routeStraightLineConstant,
      routeStraightLineLength,
    }
  }

  override _setup() {
    void this.problemSetup
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
      this.currentRouteBlockedRouteHits.clear()

      this.resetCandidateBestCosts()
      state.candidateQueue.clear()
      state.goalPortId = problem.routeEndPort[state.currentRouteId!]
      let sawStartPortWithIncidentRegion = false

      for (const startingPortId of this.problemSetup.routeStartPortCandidates[
        state.currentRouteId!
      ] ?? []) {
        if (this.isPortReservedForDifferentNet(startingPortId)) {
          continue
        }

        const assignedNetId = state.portAssignment[startingPortId]
        if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
          this.recordBlockingRouteByPortId(startingPortId)
          continue
        }

        const startingNextRegionId = this.getStartingNextRegionId(
          state.currentRouteId!,
          startingPortId,
        )

        if (startingNextRegionId === undefined) {
          continue
        }

        sawStartPortWithIncidentRegion = true

        if (this.isGoalPortForCurrentRoute(startingPortId)) {
          state.goalPortId = startingPortId
          this.onPathFound({
            nextRegionId: startingNextRegionId,
            portId: startingPortId,
            f: 0,
            g: 0,
            h: 0,
          })
          return
        }

        this.setCandidateBestCost(
          this.getHopId(startingPortId, startingNextRegionId),
          0,
        )
        const h = this.computeH(startingPortId)
        state.candidateQueue.queue({
          nextRegionId: startingNextRegionId,
          portId: startingPortId,
          f: h,
          g: 0,
          h,
        })
      }

      if (!sawStartPortWithIncidentRegion) {
        const fallbackStartPortId = problem.routeStartPort[state.currentRouteId!]
        this.failed = true
        this.error = `Start port ${fallbackStartPortId} has no incident regions`
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
      if (this.isGoalPortForCurrentRoute(neighborPortId)) {
        if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
          this.recordBlockingRouteByPortId(neighborPortId)
          continue
        }
        state.goalPortId = neighborPortId
        this.onPathFound(currentCandidate)
        return
      }
      if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
        this.recordBlockingRouteByPortId(neighborPortId)
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

      if (this.isGoalPortForCurrentRoute(neighborPortId)) {
        state.goalPortId = neighborPortId
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

  isGoalPortForCurrentRoute(portId: PortId): boolean {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) {
      return false
    }

    return this.problemSetup.routeEndPortCandidateSets[routeId]?.has(portId)
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

  recordBlockingRouteByPortId(portId: PortId) {
    const blockingRouteId = this.state.portAssignedRouteId[portId]

    if (blockingRouteId < 0 || blockingRouteId === this.state.currentRouteId) {
      return
    }

    this.currentRouteBlockedRouteHits.set(
      blockingRouteId,
      (this.currentRouteBlockedRouteHits.get(blockingRouteId) ?? 0) + 1,
    )
  }

  replayRoutedStateFromRegionSegments(
    regionSegments: Array<[RouteId, PortId, PortId][]>,
  ) {
    const { topology, state } = this

    state.portAssignment.fill(-1)
    state.portAssignedRouteId.fill(-1)
    state.regionSegments = Array.from(
      { length: topology.regionCount },
      () => [],
    )
    state.regionIntersectionCaches = Array.from(
      { length: topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    state.currentRouteId = undefined
    state.currentRouteNetId = undefined
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    state.goalPortId = -1

    for (let regionId = 0; regionId < regionSegments.length; regionId++) {
      for (const [routeId, fromPortId, toPortId] of regionSegments[regionId]!) {
        state.currentRouteNetId = this.problem.routeNet[routeId]
        state.regionSegments[regionId]!.push([routeId, fromPortId, toPortId])
        state.portAssignment[fromPortId] = state.currentRouteNetId
        state.portAssignment[toPortId] = state.currentRouteNetId
        state.portAssignedRouteId[fromPortId] = routeId
        state.portAssignedRouteId[toPortId] = routeId
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }

    state.currentRouteId = undefined
    state.currentRouteNetId = undefined
  }

  tryLocalRipUpForBlockedRoutes() {
    const { state } = this
    const currentRouteId = state.currentRouteId

    if (
      currentRouteId === undefined ||
      this.currentRouteBlockedRouteHits.size === 0
    ) {
      return false
    }

    const blockingRouteIds = [...this.currentRouteBlockedRouteHits.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])
      .map(([routeId]) => routeId)
      .slice(0, 6)

    if (blockingRouteIds.length === 0) {
      return false
    }

    const rippedRouteIdSet = new Set(blockingRouteIds)
    const keptRegionSegments = state.regionSegments.map((regionSegments) =>
      regionSegments
        .filter(([routeId]) => !rippedRouteIdSet.has(routeId))
        .map(
          ([routeId, fromPortId, toPortId]) =>
            [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
        ),
    )

    this.replayRoutedStateFromRegionSegments(keptRegionSegments)
    state.unroutedRoutes = [
      currentRouteId,
      ...blockingRouteIds,
      ...state.unroutedRoutes.filter(
        (routeId) =>
          routeId !== currentRouteId && !rippedRouteIdSet.has(routeId),
      ),
    ]
    state.ripCount += 1
    this.currentRouteBlockedRouteHits.clear()
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      reripReason: "local_blockers",
      reripRouteCount: blockingRouteIds.length,
    }
    return true
  }

  resetRoutingStateForRerip() {
    const { topology, problem, state } = this

    state.portAssignment.fill(-1)
    state.portAssignedRouteId.fill(-1)
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
    this.currentRouteBlockedRouteHits.clear()
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
      reripRegionCount: regionIdsOverCostThreshold.length,
    }
  }

  onOutOfCandidates() {
    const { topology, state } = this

    if (this.tryLocalRipUpForBlockedRoutes()) {
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
      reripReason: "out_of_candidates",
    }
  }

  onPathFound(finalCandidate: Candidate) {
    const { state } = this
    const currentRouteId = state.currentRouteId

    if (currentRouteId === undefined) return

    const solvedSegments = this.getSolvedPathSegments(finalCandidate)

    for (const { regionId, fromPortId, toPortId } of solvedSegments) {
      state.regionSegments[regionId].push([
        currentRouteId,
        fromPortId,
        toPortId,
      ])
      state.portAssignment[fromPortId] = state.currentRouteNetId!
      state.portAssignment[toPortId] = state.currentRouteNetId!
      state.portAssignedRouteId[fromPortId] = currentRouteId
      state.portAssignedRouteId[toPortId] = currentRouteId
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }

    state.candidateQueue.clear()
    state.currentRouteNetId = undefined
    state.currentRouteId = undefined
    this.currentRouteBlockedRouteHits.clear()
  }

  getStraightLineDeviationCost(routeId: RouteId, portId: PortId): number {
    if (this.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR === 0) {
      return 0
    }

    const length = this.problemSetup.routeStraightLineLength[routeId]
    if (!(length > 0)) {
      return 0
    }

    const x = this.topology.portX[portId]
    const y = this.topology.portY[portId]
    const deviation =
      Math.abs(
        this.problemSetup.routeStraightLineDy[routeId]! * x -
          this.problemSetup.routeStraightLineDx[routeId]! * y +
          this.problemSetup.routeStraightLineConstant[routeId]!,
      ) / length

    // Keep straight-line guidance gentle enough that congestion and intersection
    // costs can still win when a detour is genuinely required.
    return (
      deviation *
      this.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR *
      this.DISTANCE_TO_COST *
      0.1
    )
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const { topology, state } = this

    const nextRegionId = currentCandidate.nextRegionId
    const dx =
      topology.portX[currentCandidate.portId] - topology.portX[neighborPortId]
    const dy =
      topology.portY[currentCandidate.portId] - topology.portY[neighborPortId]
    const travelDistanceCost = Math.hypot(dx, dy) * this.TRAVEL_DISTANCE_TO_COST

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
    const straightLineDeviationCost = this.getStraightLineDeviationCost(
      state.currentRouteId!,
      neighborPortId,
    )

    return (
      currentCandidate.g +
      travelDistanceCost +
      straightLineDeviationCost +
      newRegionCost +
      state.regionCongestionCost[nextRegionId]
    )
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
