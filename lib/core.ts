import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  computeTinyHyperGraphBusRouteGuides,
  computeTinyHyperGraphFixedBusRouteSegments,
} from "./bus-routing"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import { computeRegionCost, isKnownSingleLayerMask } from "./computeRegionCost"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import { MinHeap } from "./MinHeap"
import { shuffle } from "./shuffle"
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
}

export interface TinyHyperGraphSolverOptionTarget {
  DISTANCE_TO_COST: number
  RIP_THRESHOLD_START: number
  RIP_THRESHOLD_END: number
  RIP_THRESHOLD_RAMP_ATTEMPTS: number
  RIP_CONGESTION_REGION_COST_FACTOR: number
  MAX_ITERATIONS: number
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
})

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f

interface SegmentGeometryScratch {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

interface SolvedStateSnapshot {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
}

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
})

const restoreSolvedStateSnapshot = (
  solver: TinyHyperGraphSolver,
  snapshot: SolvedStateSnapshot,
) => {
  const clonedSnapshot = cloneSolvedStateSnapshot(snapshot)
  solver.state.portAssignment = clonedSnapshot.portAssignment
  solver.state.regionSegments = clonedSnapshot.regionSegments
  solver.state.regionIntersectionCaches =
    clonedSnapshot.regionIntersectionCaches
}

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  private _problemSetup?: TinyHyperGraphProblemSetup
  private _busRoutesSetupDone = false
  private busFixedSnapshot?: SolvedStateSnapshot
  private mutableRouteIds?: RouteId[]
  private guidedRegionIdsByRouteId?: Array<RegionId[] | undefined>
  private guidedRegionIndexByRouteId?: Array<Map<RegionId, number> | undefined>
  private preferredBoundaryPortIdsByRouteId?: Array<PortId[] | undefined>
  private guidedRouteIdsInSolveOrder?: RouteId[]
  private unguidedRouteIds?: RouteId[]
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
  BUS_FIXED_REGION_CONGESTION_COST_FACTOR = 0.1
  BUS_BOUNDARY_PORT_PREFERENCE_DISTANCE_TO_COST = 0.02
  BUS_NON_PREFERRED_BOUNDARY_PORT_PENALTY = 0.02

  override MAX_ITERATIONS = 1e6

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
    if (!this._busRoutesSetupDone) {
      this.setupFixedBusRoutes()
    }
    void this.problemSetup
  }

  setupFixedBusRoutes() {
    this._busRoutesSetupDone = true

    const fixedBusRouteSegments = computeTinyHyperGraphFixedBusRouteSegments(
      this.topology,
      this.problem,
    )
    if (!fixedBusRouteSegments) {
      this.setupBusRouteGuides()
      return
    }

    const fixedRouteIdSet = new Set(fixedBusRouteSegments.fixedRouteIds)

    for (
      let regionId = 0;
      regionId < fixedBusRouteSegments.routeSegmentsByRegion.length;
      regionId++
    ) {
      const fixedRouteSegmentsInRegion =
        fixedBusRouteSegments.routeSegmentsByRegion[regionId] ?? []
      if (fixedRouteSegmentsInRegion.length === 0) {
        continue
      }

      for (const [
        routeId,
        fromPortId,
        toPortId,
      ] of fixedRouteSegmentsInRegion) {
        const routeNetId = this.problem.routeNet[routeId]
        this.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        this.state.portAssignment[fromPortId] = routeNetId
        this.state.portAssignment[toPortId] = routeNetId
      }

      const approximateRegionCapacity = Math.max(
        1,
        this.topology.regionIncidentPorts[regionId]!.length,
      )
      this.state.regionCongestionCost[regionId] +=
        (fixedRouteSegmentsInRegion.length / approximateRegionCapacity) *
        this.BUS_FIXED_REGION_CONGESTION_COST_FACTOR
    }

    this.mutableRouteIds = range(this.problem.routeCount).filter(
      (routeId) => !fixedRouteIdSet.has(routeId),
    )
    this.state.unroutedRoutes = [...this.mutableRouteIds]
    this.busFixedSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
    })
  }

  setupBusRouteGuides() {
    this._busRoutesSetupDone = true

    const busRouteGuides = computeTinyHyperGraphBusRouteGuides(
      this.topology,
      this.problem,
    )
    if (!busRouteGuides) {
      this.unguidedRouteIds = range(this.problem.routeCount)
      return
    }

    this.guidedRegionIdsByRouteId = busRouteGuides.guidedRegionIdsByRouteId
    this.guidedRegionIndexByRouteId =
      busRouteGuides.guidedRegionIdsByRouteId.map((guidedRegionIds) =>
        guidedRegionIds
          ? new Map(
              guidedRegionIds.map((regionId, regionIndex) => [
                regionId,
                regionIndex,
              ]),
            )
          : undefined,
      )
    this.preferredBoundaryPortIdsByRouteId =
      busRouteGuides.preferredBoundaryPortIdsByRouteId
    this.guidedRouteIdsInSolveOrder = [
      ...busRouteGuides.guidedRouteIdsInSolveOrder,
    ]
    const guidedRouteIdSet = new Set(this.guidedRouteIdsInSolveOrder)
    this.unguidedRouteIds = range(this.problem.routeCount).filter(
      (routeId) => !guidedRouteIdSet.has(routeId),
    )
    this.state.unroutedRoutes = this.getRouteIdsInSolveOrderForRip(0)
  }

  getRouteIdsInSolveOrderForRip(ripCount: number) {
    return [
      ...(this.guidedRouteIdsInSolveOrder ?? []),
      ...shuffle(
        [...(this.unguidedRouteIds ?? range(this.problem.routeCount))],
        ripCount,
      ),
    ]
  }

  getGuidedRegionIds(routeId: RouteId) {
    return this.guidedRegionIdsByRouteId?.[routeId]
  }

  getGuidedRegionIndex(routeId: RouteId, regionId: RegionId) {
    return this.guidedRegionIndexByRouteId?.[routeId]?.get(regionId)
  }

  getGuidedFinalRegionId(routeId: RouteId) {
    const guidedRegionIds = this.getGuidedRegionIds(routeId)
    return guidedRegionIds?.[guidedRegionIds.length - 1]
  }

  getExpectedNextGuidedRegionId(routeId: RouteId, regionId: RegionId) {
    const guidedRegionIds = this.getGuidedRegionIds(routeId)
    const guidedRegionIndex = this.getGuidedRegionIndex(routeId, regionId)
    if (
      !guidedRegionIds ||
      guidedRegionIndex === undefined ||
      guidedRegionIndex < 0
    ) {
      return undefined
    }

    return guidedRegionIds[guidedRegionIndex + 1]
  }

  getPreferredBoundaryPortId(routeId: RouteId, regionId: RegionId) {
    const guidedRegionIndex = this.getGuidedRegionIndex(routeId, regionId)
    if (guidedRegionIndex === undefined || guidedRegionIndex < 0) {
      return undefined
    }

    return this.preferredBoundaryPortIdsByRouteId?.[routeId]?.[
      guidedRegionIndex
    ]
  }

  getGuidedBoundaryPortPreferenceCost(
    routeId: RouteId,
    regionId: RegionId,
    boundaryPortId: PortId,
  ) {
    const preferredBoundaryPortId = this.getPreferredBoundaryPortId(
      routeId,
      regionId,
    )
    if (
      preferredBoundaryPortId === undefined ||
      preferredBoundaryPortId === boundaryPortId
    ) {
      return 0
    }

    const preferredBoundaryPortAssignedNetId =
      this.state.portAssignment[preferredBoundaryPortId]
    if (
      this.isPortReservedForDifferentNet(preferredBoundaryPortId) ||
      (preferredBoundaryPortAssignedNetId !== -1 &&
        preferredBoundaryPortAssignedNetId !== this.state.currentRouteNetId)
    ) {
      return 0
    }

    const dx =
      this.topology.portX[boundaryPortId] -
      this.topology.portX[preferredBoundaryPortId]
    const dy =
      this.topology.portY[boundaryPortId] -
      this.topology.portY[preferredBoundaryPortId]

    return (
      this.BUS_NON_PREFERRED_BOUNDARY_PORT_PENALTY +
      Math.hypot(dx, dy) * this.BUS_BOUNDARY_PORT_PREFERENCE_DISTANCE_TO_COST
    )
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
    const currentRouteId = state.currentRouteId!
    const guidedFinalRegionId = this.getGuidedFinalRegionId(currentRouteId)
    const expectedNextGuidedRegionId = this.getExpectedNextGuidedRegionId(
      currentRouteId,
      currentCandidate.nextRegionId,
    )

    for (const neighborPortId of neighbors) {
      const assignedNetId = state.portAssignment[neighborPortId]
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (neighborPortId === state.goalPortId) {
        if (
          guidedFinalRegionId !== undefined &&
          currentCandidate.nextRegionId !== guidedFinalRegionId
        ) {
          continue
        }
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

      let g = this.computeG(currentCandidate, neighborPortId)
      if (!Number.isFinite(g)) continue
      const h = this.computeH(neighborPortId)

      const nextRegionId =
        topology.incidentPortRegion[neighborPortId][0] ===
        currentCandidate.nextRegionId
          ? topology.incidentPortRegion[neighborPortId][1]
          : topology.incidentPortRegion[neighborPortId][0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNet(nextRegionId) ||
        (expectedNextGuidedRegionId !== undefined &&
          nextRegionId !== expectedNextGuidedRegionId) ||
        (expectedNextGuidedRegionId === undefined &&
          guidedFinalRegionId !== undefined)
      ) {
        continue
      }

      if (expectedNextGuidedRegionId !== undefined) {
        g += this.getGuidedBoundaryPortPreferenceCost(
          currentRouteId,
          currentCandidate.nextRegionId,
          neighborPortId,
        )
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
    const guidedRegionIds = this.getGuidedRegionIds(routeId)
    if (guidedRegionIds?.length) {
      const guidedStartingRegionId = guidedRegionIds[0]
      return startingIncidentRegions.includes(guidedStartingRegionId)
        ? guidedStartingRegionId
        : undefined
    }
    const currentRouteNetId = this.problem.routeNet[routeId]
    const endPortId = this.problem.routeEndPort[routeId]

    return [...startingIncidentRegions].sort((leftRegionId, rightRegionId) => {
      const leftIncidentPortCount =
        this.topology.regionIncidentPorts[leftRegionId]?.length ?? 0
      const rightIncidentPortCount =
        this.topology.regionIncidentPorts[rightRegionId]?.length ?? 0
      const leftIsDeadEnd = leftIncidentPortCount <= 1 ? 1 : 0
      const rightIsDeadEnd = rightIncidentPortCount <= 1 ? 1 : 0

      if (leftIsDeadEnd !== rightIsDeadEnd) {
        return leftIsDeadEnd - rightIsDeadEnd
      }

      const leftReservedNetId = this.problem.regionNetId[leftRegionId]
      const rightReservedNetId = this.problem.regionNetId[rightRegionId]
      const leftPriority =
        leftReservedNetId === -1
          ? 0
          : leftReservedNetId === currentRouteNetId
            ? 1
            : 2
      const rightPriority =
        rightReservedNetId === -1
          ? 0
          : rightReservedNetId === currentRouteNetId
            ? 1
            : 2

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }

      if (leftIncidentPortCount !== rightIncidentPortCount) {
        return rightIncidentPortCount - leftIncidentPortCount
      }

      const leftDistanceToEnd = Math.hypot(
        this.topology.regionCenterX[leftRegionId] -
          this.topology.portX[endPortId],
        this.topology.regionCenterY[leftRegionId] -
          this.topology.portY[endPortId],
      )
      const rightDistanceToEnd = Math.hypot(
        this.topology.regionCenterX[rightRegionId] -
          this.topology.portX[endPortId],
        this.topology.regionCenterY[rightRegionId] -
          this.topology.portY[endPortId],
      )
      return leftDistanceToEnd - rightDistanceToEnd
    })[0]
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

  resetRoutingStateForRerip() {
    const { topology, problem, state } = this

    if (this.busFixedSnapshot) {
      restoreSolvedStateSnapshot(this, this.busFixedSnapshot)
      state.currentRouteNetId = undefined
      state.currentRouteId = undefined
      state.unroutedRoutes = shuffle(
        [...(this.mutableRouteIds ?? range(problem.routeCount))],
        state.ripCount,
      )
      state.candidateQueue.clear()
      this.resetCandidateBestCosts()
      state.goalPortId = -1
      return
    }

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
    state.unroutedRoutes = this.getRouteIdsInSolveOrderForRip(state.ripCount)
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    state.goalPortId = -1
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
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
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
