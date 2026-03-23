import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver, BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "./compat/convertToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import { computeRegionCost } from "./computeRegionCost"
import { countNewIntersections } from "./countNewIntersections"
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

const createEmptyRegionIntersectionCache = (): RegionIntersectionCache => ({
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
  // portAssignment[portId] = RouteId, -1 means unassigned
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

  goalPortId: PortId

  ripCount: number

  /** regionCongestionCost[regionId] = congestion cost */
  regionCongestionCost: Float64Array
}

interface SolvedStateSnapshot {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  regionIntersectionCaches: RegionIntersectionCache[]
}

interface SectionRoutePlan {
  routeId: RouteId
  fixedSegments: Array<[PortId, PortId]>
  activeStartPortId?: PortId
  activeEndPortId?: PortId
  forcedStartRegionId?: RegionId
}

const compareCandidatesByF = (left: Candidate, right: Candidate) =>
  left.f - right.f

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  problemSetup: TinyHyperGraphProblemSetup

  DISTANCE_TO_COST = 0.05 // 50mm = 1 cost unit (1 cost unit ~ 100% chance of failure)

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1

  override MAX_ITERATIONS = 1e6

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
  ) {
    super()
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
      ).fill(Number.POSITIVE_INFINITY),
      goalPortId: -1,
      ripCount: 0,
      regionCongestionCost: new Float64Array(topology.regionCount).fill(0),
    }
    this.problemSetup = this.computeProblemSetup()
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

  override _step() {
    const { problem, topology, state } = this

    if (state.currentRouteId === undefined) {
      if (state.unroutedRoutes.length === 0) {
        this.onAllRoutesRouted()
        return
      }

      state.currentRouteId = state.unroutedRoutes.shift()
      state.currentRouteNetId = problem.routeNet[state.currentRouteId!]

      state.candidateBestCostByHopId.fill(Number.POSITIVE_INFINITY)
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

      state.candidateBestCostByHopId[
        this.getHopId(startingPortId, startingNextRegionId)
      ] = 0
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
    if (
      currentCandidate.g > state.candidateBestCostByHopId[currentCandidateHopId]
    ) {
      return
    }

    if (this.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) {
      return
    }

    const neighbors =
      topology.regionIncidentPorts[currentCandidate.nextRegionId]

    for (const neighborPortId of neighbors) {
      const assignedRouteId = state.portAssignment[neighborPortId]
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (neighborPortId === state.goalPortId) {
        if (
          assignedRouteId !== -1 &&
          problem.routeNet[assignedRouteId] !== state.currentRouteNetId
        ) {
          continue
        }
        this.onPathFound(currentCandidate)
        return
      }
      if (assignedRouteId !== -1) continue
      if (neighborPortId === currentCandidate.portId) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue

      const g = this.computeG(currentCandidate, neighborPortId)
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
      if (g >= state.candidateBestCostByHopId[candidateHopId]) continue

      state.candidateBestCostByHopId[candidateHopId] = g
      state.candidateQueue.queue(newCandidate)
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

  getPortAngleInRegion(portId: PortId, regionId: RegionId): number {
    const { topology } = this
    const [firstRegionId, secondRegionId] =
      topology.incidentPortRegion[portId] ?? []

    if (firstRegionId === regionId) {
      return topology.portAngleForRegion1[portId]
    }

    if (secondRegionId === regionId) {
      return (
        topology.portAngleForRegion2?.[portId] ??
        topology.portAngleForRegion1[portId]
      )
    }

    return topology.portAngleForRegion1[portId]
  }

  buildDynamicAnglePair(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ): DynamicAnglePair {
    const { topology, state } = this
    const angle1 = this.getPortAngleInRegion(port1Id, regionId)
    const angle2 = this.getPortAngleInRegion(port2Id, regionId)
    const z1 = topology.portZ[port1Id]
    const z2 = topology.portZ[port2Id]

    if (angle1 < angle2) {
      return [state.currentRouteNetId!, angle1, z1, angle2, z2]
    }

    return [state.currentRouteNetId!, angle2, z2, angle1, z1]
  }

  appendSegmentToRegionCache(
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ) {
    const { topology, state } = this
    const regionCache = state.regionIntersectionCaches[regionId]
    const newPair = this.buildDynamicAnglePair(regionId, port1Id, port2Id)
    const [
      newSameLayerIntersections,
      newCrossLayerIntersections,
      newEntryExitLayerChanges,
    ] = countNewIntersections(regionCache, newPair)
    const [netId, lesserAngle, z1, greaterAngle, z2] = newPair
    const nextLength = regionCache.netIds.length + 1

    const netIds = new Int32Array(nextLength)
    netIds.set(regionCache.netIds)
    netIds[nextLength - 1] = netId

    const lesserAngles = new Int32Array(nextLength)
    lesserAngles.set(regionCache.lesserAngles)
    lesserAngles[nextLength - 1] = lesserAngle

    const greaterAngles = new Int32Array(nextLength)
    greaterAngles.set(regionCache.greaterAngles)
    greaterAngles[nextLength - 1] = greaterAngle

    const layerMasks = new Int32Array(nextLength)
    layerMasks.set(regionCache.layerMasks)
    layerMasks[nextLength - 1] = (1 << z1) | (1 << z2)

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
    state.candidateBestCostByHopId.fill(Number.POSITIVE_INFINITY)
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
      state.ripCount === this.RIP_THRESHOLD_RAMP_ATTEMPTS
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
      state.portAssignment[fromPortId] = currentRouteId
      state.portAssignment[toPortId] = currentRouteId
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

    const newPair = this.buildDynamicAnglePair(
      nextRegionId,
      currentCandidate.portId,
      neighborPortId,
    )

    const [
      newSameLayerIntersections,
      newCrossLayerIntersections,
      newEntryExitLayerChanges,
    ] = countNewIntersections(regionCache, newPair)

    const newRegionCost =
      computeRegionCost(
        topology.regionWidth[nextRegionId],
        topology.regionHeight[nextRegionId],
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

const summarizeRegionIntersectionCaches = (
  regionIntersectionCaches: ArrayLike<RegionIntersectionCache>,
): RegionCostSummary => {
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (
    let regionId = 0;
    regionId < regionIntersectionCaches.length;
    regionId++
  ) {
    const regionCost =
      regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
    maxRegionCost = Math.max(maxRegionCost, regionCost)
    totalRegionCost += regionCost
  }

  return {
    maxRegionCost,
    totalRegionCost,
  }
}

const compareRegionCostSummaries = (
  left: RegionCostSummary,
  right: RegionCostSummary,
) => {
  if (left.maxRegionCost !== right.maxRegionCost) {
    return left.maxRegionCost - right.maxRegionCost
  }

  return left.totalRegionCost - right.totalRegionCost
}

const getSharedRegionIdForPorts = (
  topology: TinyHyperGraphTopology,
  fromPortId: PortId,
  toPortId: PortId,
): RegionId => {
  const fromIncidentRegions = topology.incidentPortRegion[fromPortId] ?? []
  const toIncidentRegions = topology.incidentPortRegion[toPortId] ?? []
  const sharedRegionId = fromIncidentRegions.find((regionId) =>
    toIncidentRegions.includes(regionId),
  )

  if (sharedRegionId === undefined) {
    throw new Error(`Ports ${fromPortId} and ${toPortId} do not share a region`)
  }

  return sharedRegionId
}

const getOrderedRoutePortIds = (
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  routeId: RouteId,
): PortId[] => {
  const routeSegments = solution.solvedRoutePathSegments[routeId] ?? []
  const startPortId = problem.routeStartPort[routeId]
  const endPortId = problem.routeEndPort[routeId]

  if (routeSegments.length === 0) {
    if (startPortId === endPortId) {
      return [startPortId]
    }

    throw new Error(`Route ${routeId} does not have an existing solved path`)
  }

  const segmentsByPort = new Map<
    PortId,
    Array<{
      segmentIndex: number
      fromPortId: PortId
      toPortId: PortId
    }>
  >()

  routeSegments.forEach(([fromPortId, toPortId], segmentIndex) => {
    const indexedSegment = {
      segmentIndex,
      fromPortId,
      toPortId,
    }

    const fromSegments = segmentsByPort.get(fromPortId) ?? []
    fromSegments.push(indexedSegment)
    segmentsByPort.set(fromPortId, fromSegments)

    const toSegments = segmentsByPort.get(toPortId) ?? []
    toSegments.push(indexedSegment)
    segmentsByPort.set(toPortId, toSegments)
  })

  const orderedPortIds = [startPortId]
  const usedSegmentIndices = new Set<number>()
  let currentPortId = startPortId
  let previousPortId: PortId | undefined

  while (currentPortId !== endPortId) {
    const nextSegments = (segmentsByPort.get(currentPortId) ?? []).filter(
      ({ segmentIndex, fromPortId, toPortId }) => {
        if (usedSegmentIndices.has(segmentIndex)) {
          return false
        }

        const nextPortId = fromPortId === currentPortId ? toPortId : fromPortId

        return nextPortId !== previousPortId
      },
    )

    if (nextSegments.length !== 1) {
      throw new Error(
        `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
      )
    }

    const nextSegment = nextSegments[0]!
    const nextPortId =
      nextSegment.fromPortId === currentPortId
        ? nextSegment.toPortId
        : nextSegment.fromPortId

    usedSegmentIndices.add(nextSegment.segmentIndex)
    orderedPortIds.push(nextPortId)
    previousPortId = currentPortId
    currentPortId = nextPortId
  }

  if (usedSegmentIndices.size !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  return orderedPortIds
}

const applyRouteSegmentsToSolver = (
  solver: TinyHyperGraphSolver,
  routeSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
) => {
  solver.state.portAssignment.fill(-1)
  solver.state.regionSegments = Array.from(
    { length: solver.topology.regionCount },
    () => [],
  )
  solver.state.regionIntersectionCaches = Array.from(
    { length: solver.topology.regionCount },
    () => createEmptyRegionIntersectionCache(),
  )
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = []
  solver.state.candidateQueue.clear()
  solver.state.candidateBestCostByHopId.fill(Number.POSITIVE_INFINITY)
  solver.state.goalPortId = -1
  solver.state.ripCount = 0
  solver.state.regionCongestionCost.fill(0)

  for (let regionId = 0; regionId < routeSegmentsByRegion.length; regionId++) {
    for (const [routeId, fromPortId, toPortId] of routeSegmentsByRegion[
      regionId
    ] ?? []) {
      solver.state.currentRouteNetId = solver.problem.routeNet[routeId]
      solver.state.regionSegments[regionId]!.push([
        routeId,
        fromPortId,
        toPortId,
      ])
      solver.state.portAssignment[fromPortId] = routeId
      solver.state.portAssignment[toPortId] = routeId
      solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
  }

  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.solved = true
  solver.failed = false
  solver.error = null
}

const createSolvedSolverFromRegionSegments = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  routeSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
) => {
  const solver = new TinyHyperGraphSolver(topology, problem)
  applyRouteSegmentsToSolver(solver, routeSegmentsByRegion)
  return solver
}

const createSolvedSolverFromSolution = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
) => {
  const routeSegmentsByRegion = Array.from(
    { length: topology.regionCount },
    () => [] as [RouteId, PortId, PortId][],
  )

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const orderedPortIds = getOrderedRoutePortIds(problem, solution, routeId)
    for (let portIndex = 1; portIndex < orderedPortIds.length; portIndex++) {
      const fromPortId = orderedPortIds[portIndex - 1]!
      const toPortId = orderedPortIds[portIndex]!
      const regionId = getSharedRegionIdForPorts(topology, fromPortId, toPortId)
      routeSegmentsByRegion[regionId]!.push([routeId, fromPortId, toPortId])
    }
  }

  return createSolvedSolverFromRegionSegments(
    topology,
    problem,
    routeSegmentsByRegion,
  )
}

const createSectionRoutePlans = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
): {
  sectionProblem: TinyHyperGraphProblem
  routePlans: SectionRoutePlan[]
  activeRouteIds: RouteId[]
} => {
  const routeStartPort = new Int32Array(problem.routeStartPort)
  const routeEndPort = new Int32Array(problem.routeEndPort)
  const routePlans: SectionRoutePlan[] = Array.from(
    { length: problem.routeCount },
    (_, routeId) => ({
      routeId,
      fixedSegments: [],
    }),
  )
  const activeRouteIds: RouteId[] = []

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routePlan = routePlans[routeId]!
    const orderedPortIds = getOrderedRoutePortIds(problem, solution, routeId)
    const maskedRuns: Array<{ startIndex: number; endIndex: number }> = []
    let currentRunStartIndex: number | undefined

    for (let portIndex = 0; portIndex < orderedPortIds.length; portIndex++) {
      const portId = orderedPortIds[portIndex]!
      const isMasked = problem.portSectionMask[portId] === 1

      if (isMasked && currentRunStartIndex === undefined) {
        currentRunStartIndex = portIndex
      } else if (!isMasked && currentRunStartIndex !== undefined) {
        maskedRuns.push({
          startIndex: currentRunStartIndex,
          endIndex: portIndex - 1,
        })
        currentRunStartIndex = undefined
      }
    }

    if (currentRunStartIndex !== undefined) {
      maskedRuns.push({
        startIndex: currentRunStartIndex,
        endIndex: orderedPortIds.length - 1,
      })
    }

    if (maskedRuns.length === 0) {
      for (let portIndex = 1; portIndex < orderedPortIds.length; portIndex++) {
        routePlan.fixedSegments.push([
          orderedPortIds[portIndex - 1]!,
          orderedPortIds[portIndex]!,
        ])
      }
      continue
    }

    if (maskedRuns.length > 1) {
      throw new Error(
        `Route ${routeId} enters the section multiple times; only one contiguous section span is currently supported`,
      )
    }

    const maskedRun = maskedRuns[0]!
    const activeStartIndex = Math.max(0, maskedRun.startIndex - 1)
    const activeEndIndex = Math.min(
      orderedPortIds.length - 1,
      maskedRun.endIndex + 1,
    )

    if (activeEndIndex <= activeStartIndex) {
      throw new Error(`Route ${routeId} does not have a valid section span`)
    }

    for (let portIndex = 1; portIndex <= activeStartIndex; portIndex++) {
      routePlan.fixedSegments.push([
        orderedPortIds[portIndex - 1]!,
        orderedPortIds[portIndex]!,
      ])
    }

    for (
      let portIndex = activeEndIndex + 1;
      portIndex < orderedPortIds.length;
      portIndex++
    ) {
      routePlan.fixedSegments.push([
        orderedPortIds[portIndex - 1]!,
        orderedPortIds[portIndex]!,
      ])
    }

    routePlan.activeStartPortId = orderedPortIds[activeStartIndex]
    routePlan.activeEndPortId = orderedPortIds[activeEndIndex]
    routePlan.forcedStartRegionId = getSharedRegionIdForPorts(
      topology,
      orderedPortIds[activeStartIndex]!,
      orderedPortIds[activeStartIndex + 1]!,
    )
    routeStartPort[routeId] = routePlan.activeStartPortId
    routeEndPort[routeId] = routePlan.activeEndPortId
    activeRouteIds.push(routeId)
  }

  return {
    sectionProblem: {
      routeCount: problem.routeCount,
      portSectionMask: new Int8Array(problem.portSectionMask),
      routeMetadata: problem.routeMetadata,
      routeStartPort,
      routeEndPort,
      routeNet: new Int32Array(problem.routeNet),
      regionNetId: new Int32Array(problem.regionNetId),
    },
    routePlans,
    activeRouteIds,
  }
}

class TinyHyperGraphSectionSearchSolver extends TinyHyperGraphSolver {
  bestSnapshot?: SolvedStateSnapshot
  bestSummary?: RegionCostSummary

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    private routePlans: SectionRoutePlan[],
    private activeRouteIds: RouteId[],
  ) {
    super(topology, problem)
    this.state.unroutedRoutes = [...activeRouteIds]
    this.applyFixedSegments()
  }

  applyFixedSegments() {
    for (const routePlan of this.routePlans) {
      for (const [fromPortId, toPortId] of routePlan.fixedSegments) {
        const regionId = getSharedRegionIdForPorts(
          this.topology,
          fromPortId,
          toPortId,
        )

        this.state.currentRouteNetId = this.problem.routeNet[routePlan.routeId]
        this.state.regionSegments[regionId]!.push([
          routePlan.routeId,
          fromPortId,
          toPortId,
        ])
        this.state.portAssignment[fromPortId] = routePlan.routeId
        this.state.portAssignment[toPortId] = routePlan.routeId
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }

    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
  }

  captureBestState(summary: RegionCostSummary) {
    if (
      this.bestSummary &&
      compareRegionCostSummaries(summary, this.bestSummary) >= 0
    ) {
      return
    }

    this.bestSummary = summary
    this.bestSnapshot = cloneSolvedStateSnapshot({
      portAssignment: this.state.portAssignment,
      regionSegments: this.state.regionSegments,
      regionIntersectionCaches: this.state.regionIntersectionCaches,
    })
  }

  restoreBestState() {
    if (!this.bestSnapshot) {
      return
    }

    const snapshot = cloneSolvedStateSnapshot(this.bestSnapshot)
    this.state.portAssignment = snapshot.portAssignment
    this.state.regionSegments = snapshot.regionSegments
    this.state.regionIntersectionCaches = snapshot.regionIntersectionCaches
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.state.candidateBestCostByHopId.fill(Number.POSITIVE_INFINITY)
    this.state.goalPortId = -1
  }

  override getStartingNextRegionId(
    routeId: RouteId,
    startingPortId: PortId,
  ): RegionId | undefined {
    const forcedStartRegionId = this.routePlans[routeId]?.forcedStartRegionId
    if (forcedStartRegionId !== undefined) {
      return forcedStartRegionId
    }

    return super.getStartingNextRegionId(routeId, startingPortId)
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.state.unroutedRoutes = shuffle(
      [...this.activeRouteIds],
      this.state.ripCount,
    )
    this.applyFixedSegments()
  }

  override onAllRoutesRouted() {
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

    this.captureBestState({
      maxRegionCost,
      totalRegionCost,
    })

    this.stats = {
      ...this.stats,
      activeRouteCount: this.activeRouteIds.length,
      currentRipThreshold,
      hotRegionCount: regionIdsOverCostThreshold.length,
      maxRegionCost,
      totalRegionCost,
      bestMaxRegionCost: this.bestSummary?.maxRegionCost ?? maxRegionCost,
      bestTotalRegionCost: this.bestSummary?.totalRegionCost ?? totalRegionCost,
      ripCount: state.ripCount,
    }

    if (
      regionIdsOverCostThreshold.length === 0 ||
      state.ripCount === this.RIP_THRESHOLD_RAMP_ATTEMPTS
    ) {
      this.restoreBestState()
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

  override tryFinalAcceptance() {
    if (!this.bestSnapshot) {
      return
    }

    this.restoreBestState()
    this.solved = true
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this, {
      highlightSectionMask: true,
      showIdlePortRegionConnectors: false,
      showInitialRouteHints: false,
      showOnlySectionPortsOnIdle: true,
    })
  }
}

export class TinyHyperGraphSectionSolver extends BaseSolver {
  baselineSolver: TinyHyperGraphSolver
  optimizedSolver?: TinyHyperGraphSolver
  sectionSolver?: TinyHyperGraphSectionSearchSolver
  activeRouteIds: RouteId[] = []

  DISTANCE_TO_COST = 0.05

  RIP_THRESHOLD_START = 0.05
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 50

  RIP_CONGESTION_REGION_COST_FACTOR = 0.1

  override MAX_ITERATIONS = 1e6

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    public initialSolution: TinyHyperGraphSolution,
  ) {
    super()
    this.baselineSolver = createSolvedSolverFromSolution(
      topology,
      problem,
      initialSolution,
    )
  }

  override _setup() {
    const { sectionProblem, routePlans, activeRouteIds } =
      createSectionRoutePlans(this.topology, this.problem, this.initialSolution)

    this.activeRouteIds = activeRouteIds

    if (activeRouteIds.length === 0) {
      this.optimizedSolver = this.baselineSolver
      const baselineSummary = summarizeRegionIntersectionCaches(
        this.baselineSolver.state.regionIntersectionCaches,
      )
      this.stats = {
        ...this.stats,
        activeRouteCount: 0,
        initialMaxRegionCost: baselineSummary.maxRegionCost,
        finalMaxRegionCost: baselineSummary.maxRegionCost,
        optimized: false,
      }
      this.solved = true
      return
    }

    this.sectionSolver = new TinyHyperGraphSectionSearchSolver(
      this.topology,
      sectionProblem,
      routePlans,
      activeRouteIds,
    )
    this.sectionSolver.DISTANCE_TO_COST = this.DISTANCE_TO_COST
    this.sectionSolver.RIP_THRESHOLD_START = this.RIP_THRESHOLD_START
    this.sectionSolver.RIP_THRESHOLD_END = this.RIP_THRESHOLD_END
    this.sectionSolver.RIP_THRESHOLD_RAMP_ATTEMPTS =
      this.RIP_THRESHOLD_RAMP_ATTEMPTS
    this.sectionSolver.RIP_CONGESTION_REGION_COST_FACTOR =
      this.RIP_CONGESTION_REGION_COST_FACTOR
    this.sectionSolver.MAX_ITERATIONS = this.MAX_ITERATIONS
    this.activeSubSolver = this.sectionSolver
  }

  override _step() {
    if (!this.sectionSolver) {
      this.solved = true
      return
    }

    this.sectionSolver.step()
    this.stats = {
      ...this.stats,
      ...this.sectionSolver.stats,
      activeRouteCount: this.activeRouteIds.length,
    }

    if (this.sectionSolver.failed) {
      this.error = this.sectionSolver.error
      this.failed = true
      return
    }

    if (!this.sectionSolver.solved) {
      return
    }

    const candidateSolver = createSolvedSolverFromRegionSegments(
      this.topology,
      this.problem,
      cloneRegionSegments(this.sectionSolver.state.regionSegments),
    )
    const baselineSummary = summarizeRegionIntersectionCaches(
      this.baselineSolver.state.regionIntersectionCaches,
    )
    const candidateSummary = summarizeRegionIntersectionCaches(
      candidateSolver.state.regionIntersectionCaches,
    )
    const optimized =
      compareRegionCostSummaries(candidateSummary, baselineSummary) < 0

    this.optimizedSolver = optimized ? candidateSolver : this.baselineSolver

    const finalSummary = optimized ? candidateSummary : baselineSummary
    this.stats = {
      ...this.stats,
      initialMaxRegionCost: baselineSummary.maxRegionCost,
      initialTotalRegionCost: baselineSummary.totalRegionCost,
      candidateMaxRegionCost: candidateSummary.maxRegionCost,
      candidateTotalRegionCost: candidateSummary.totalRegionCost,
      finalMaxRegionCost: finalSummary.maxRegionCost,
      finalTotalRegionCost: finalSummary.totalRegionCost,
      optimized,
    }
    this.solved = true
  }

  getSolvedSolver(): TinyHyperGraphSolver {
    if (!this.solved || this.failed || !this.optimizedSolver) {
      throw new Error(
        "TinyHyperGraphSectionSolver does not have a solved output yet",
      )
    }

    return this.optimizedSolver
  }

  override visualize(): GraphicsObject {
    if (this.optimizedSolver) {
      return visualizeTinyGraph(this.optimizedSolver, {
        highlightSectionMask: true,
      })
    }

    if (this.sectionSolver) {
      return this.sectionSolver.visualize()
    }

    return visualizeTinyGraph(this.baselineSolver, {
      highlightSectionMask: true,
      showIdlePortRegionConnectors: false,
      showInitialRouteHints: false,
      showOnlySectionPortsOnIdle: true,
    })
  }

  override getOutput() {
    return this.getSolvedSolver().getOutput()
  }
}

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: RegionId[],
) => {
  const adjacentRegionIds = new Set(seedRegionIds)

  for (const seedRegionId of seedRegionIds) {
    for (const portId of topology.regionIncidentPorts[seedRegionId] ?? []) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(regionId)
      }
    }
  }

  return [...adjacentRegionIds]
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: RegionId[],
  mode: "any" | "both",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (mode === "any") {
      return incidentRegionIds.some((regionId) =>
        selectedRegionIds.has(regionId),
      )
        ? 1
        : 0
    }

    return incidentRegionIds.length > 0 &&
      incidentRegionIds.every((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const createAutomaticSectionPortMask = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
) => {
  const hotRegionIds = solvedSolver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, 12)
    .map(({ regionId }) => regionId)

  for (const hotRegionId of hotRegionIds) {
    const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])
    const twoHopRegionIds = getAdjacentRegionIds(topology, oneHopRegionIds)

    const regionCandidates: Array<{
      regionIds: RegionId[]
      mode: "any" | "both"
    }> = [
      { regionIds: [hotRegionId], mode: "both" },
      { regionIds: [hotRegionId], mode: "any" },
      { regionIds: oneHopRegionIds, mode: "both" },
      { regionIds: oneHopRegionIds, mode: "any" },
      { regionIds: twoHopRegionIds, mode: "both" },
    ]

    for (const regionCandidate of regionCandidates) {
      const candidateProblem: TinyHyperGraphProblem = {
        routeCount: problem.routeCount,
        portSectionMask: createPortSectionMaskForRegionIds(
          topology,
          regionCandidate.regionIds,
          regionCandidate.mode,
        ),
        routeMetadata: problem.routeMetadata,
        routeStartPort: new Int32Array(problem.routeStartPort),
        routeEndPort: new Int32Array(problem.routeEndPort),
        routeNet: new Int32Array(problem.routeNet),
        regionNetId: new Int32Array(problem.regionNetId),
      }

      try {
        const { activeRouteIds } = createSectionRoutePlans(
          topology,
          candidateProblem,
          solution,
        )

        if (activeRouteIds.length > 0) {
          return candidateProblem.portSectionMask
        }
      } catch {
        // Skip invalid section masks that split a route into multiple spans.
      }
    }
  }

  return new Int8Array(topology.portCount)
}

export interface TinyHyperGraphSectionMaskContext {
  serializedHyperGraph: SerializedHyperGraph
  solvedSerializedHyperGraph: SerializedHyperGraph
  solvedSolver: TinyHyperGraphSolver
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
}

export interface TinyHyperGraphSectionPipelineInput {
  serializedHyperGraph: SerializedHyperGraph
  createSectionMask?: (context: TinyHyperGraphSectionMaskContext) => Int8Array
}

export class TinyHyperGraphSectionPipelineSolver extends BasePipelineSolver<TinyHyperGraphSectionPipelineInput> {
  initialVisualizationSolver?: TinyHyperGraphSolver

  override pipelineDef = [
    {
      solverName: "solveGraph",
      solverClass: TinyHyperGraphSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) => {
        const { topology, problem } = loadSerializedHyperGraph(
          instance.inputProblem.serializedHyperGraph,
        )
        return [topology, problem]
      },
    },
    {
      solverName: "optimizeSection",
      solverClass: TinyHyperGraphSectionSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) =>
        instance.getSectionStageParams(),
    },
  ]

  getSectionStageParams(): [
    TinyHyperGraphTopology,
    TinyHyperGraphProblem,
    TinyHyperGraphSolution,
  ] {
    const solvedSerializedHyperGraph =
      this.getStageOutput<SerializedHyperGraph>("solveGraph")

    if (!solvedSerializedHyperGraph) {
      throw new Error(
        "solveGraph did not produce a solved serialized hypergraph",
      )
    }

    const solvedSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")

    if (!solvedSolver) {
      throw new Error("solveGraph solver is unavailable")
    }

    const { topology, problem, solution } = loadSerializedHyperGraph(
      solvedSerializedHyperGraph,
    )
    problem.portSectionMask = this.inputProblem.createSectionMask
      ? this.inputProblem.createSectionMask({
          serializedHyperGraph: this.inputProblem.serializedHyperGraph,
          solvedSerializedHyperGraph,
          solvedSolver,
          topology,
          problem,
          solution,
        })
      : createAutomaticSectionPortMask(
          solvedSolver,
          topology,
          problem,
          solution,
        )

    return [topology, problem, solution]
  }

  getInitialVisualizationSolver() {
    if (!this.initialVisualizationSolver) {
      const { topology, problem } = loadSerializedHyperGraph(
        this.inputProblem.serializedHyperGraph,
      )
      this.initialVisualizationSolver = new TinyHyperGraphSolver(
        topology,
        problem,
      )
    }

    return this.initialVisualizationSolver
  }

  override initialVisualize() {
    return this.getInitialVisualizationSolver().visualize()
  }

  override visualize(): GraphicsObject {
    if (this.iterations === 0) {
      return this.initialVisualize() ?? super.visualize()
    }

    return super.visualize()
  }

  override getOutput() {
    return (
      this.getStageOutput<SerializedHyperGraph>("optimizeSection") ??
      this.getStageOutput<SerializedHyperGraph>("solveGraph") ??
      null
    )
  }
}
