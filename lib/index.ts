import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { computeRegionCost } from "./computeRegionCost"
import { countNewIntersections } from "./countNewIntersections"
import type {
  DynamicAnglePair,
  NetId,
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
  SegmentId,
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
})

const createMulberry32 = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffleRouteIds = (routeIds: RouteId[], seed: number): RouteId[] => {
  const shuffled = [...routeIds]
  const random = createMulberry32(seed)

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return shuffled
}

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

  /** portAngle[portId] = CCW angle of the port where 0 is the right side, 9000 is the top, used for fast intersection calculations */
  portAngle: Int32Array
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
}

export interface TinyHyperGraphProblemSetup {
  // portHCostToEndOfRoute[portId * routeCount + routeId] = distance from port to end of route
  portHCostToEndOfRoute: Float64Array
}

export interface TinyHyperGraphSolution {
  /** solvedRoutePathSegments[routeId] = list of segments, each segment is an ordered list of port ids in the route */
  solvedRoutePathSegments: Array<[PortId, PortId][]>
}

export interface Candidate {
  prevRegionId?: RegionId
  portId: PortId
  nextRegionId: RegionId

  prevCandidate?: Candidate
  segmentId: SegmentId

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

  visitedSegments: Set<SegmentId>

  candidates: Candidate[]

  goalPortId: PortId

  ripCount: number

  /** regionCongestionCost[regionId] = congestion cost */
  regionCongestionCost: Float64Array
}

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  problemSetup: TinyHyperGraphProblemSetup

  DISTANCE_TO_COST = 0.05 // 50mm = 1 cost unit (1 cost unit ~ 100% chance of failure)

  RIP_THRESHOLD_START = 0.3
  RIP_THRESHOLD_END = 0.8
  RIP_THRESHOLD_RAMP_ATTEMPTS = 20

  RIP_CONGESTION_REGION_COST_FACTOR = 0.05

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
      visitedSegments: new Set(),
      candidates: [],
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

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
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

      state.visitedSegments.clear()
      const startingPortId = problem.routeStartPort[state.currentRouteId!]
      state.candidates = [
        {
          nextRegionId: topology.incidentPortRegion[startingPortId][0],
          portId: startingPortId,
          f: 0,
          g: 0,
          h: 0,
          segmentId: 0,
        },
      ]
      state.goalPortId = problem.routeEndPort[state.currentRouteId!]
    }

    state.candidates.sort((a, b) => b.f - a.f)
    const currentCandidate = state.candidates.pop()

    if (!currentCandidate) {
      this.failed = true
      this.error = "No candidates left"
      return
    }

    state.visitedSegments.add(currentCandidate.segmentId)

    const neighbors =
      topology.regionIncidentPorts[currentCandidate.nextRegionId]

    const segmentIdPart1 = currentCandidate.portId * topology.portCount
    for (const neighborPortId of neighbors) {
      if (neighborPortId === state.goalPortId) {
        this.onPathFound(currentCandidate)
        return
      }
      if (state.portAssignment[neighborPortId] !== -1) continue
      if (state.visitedSegments.has(segmentIdPart1 + neighborPortId)) continue
      if (neighborPortId === currentCandidate.portId) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue

      const g = this.computeG(currentCandidate, neighborPortId)
      const h = this.computeH(neighborPortId)

      const nextRegionId =
        topology.incidentPortRegion[neighborPortId][0] ===
        currentCandidate.nextRegionId
          ? topology.incidentPortRegion[neighborPortId][1]
          : topology.incidentPortRegion[neighborPortId][0]

      const newCandidate = {
        lastRegionId: currentCandidate.nextRegionId,
        nextRegionId,
        portId: neighborPortId,
        g,
        h,
        f: g + h,
        segmentId:
          currentCandidate.portId * topology.portCount + neighborPortId,
        prevCandidate: currentCandidate,
      }

      if (neighborPortId === state.goalPortId) {
        this.onPathFound(newCandidate)
        return
      }

      state.candidates.push(newCandidate)
    }
  }

  buildDynamicAnglePair(port1Id: PortId, port2Id: PortId): DynamicAnglePair {
    const { topology, state } = this
    const angle1 = topology.portAngle[port1Id]
    const angle2 = topology.portAngle[port2Id]
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
    const newPair = this.buildDynamicAnglePair(port1Id, port2Id)
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

    state.regionIntersectionCaches[regionId] = {
      netIds,
      lesserAngles,
      greaterAngles,
      layerMasks,
      existingSameLayerIntersections,
      existingCrossingLayerIntersections,
      existingEntryExitLayerChanges,
      existingRegionCost: computeRegionCost(
        topology.regionWidth[regionId],
        topology.regionHeight[regionId],
        existingSameLayerIntersections,
        existingCrossingLayerIntersections,
        existingEntryExitLayerChanges,
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
    state.unroutedRoutes = shuffleRouteIds(
      range(problem.routeCount),
      state.ripCount,
    )
    state.visitedSegments.clear()
    state.candidates = []
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

    const ripRegionIds: RegionId[] = []
    const regionCosts = new Float64Array(topology.regionCount)
    let maxRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)

      if (regionCost > currentRipThreshold) {
        ripRegionIds.push(regionId)
      }
    }

    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: ripRegionIds.length,
      maxRegionCost,
      ripCount: state.ripCount,
    }

    if (ripRegionIds.length === 0) {
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
      reripRegionCount: ripRegionIds.length,
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

    state.candidates = []
    state.currentRouteNetId = undefined
    state.currentRouteId = undefined
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const { topology, state } = this

    const nextRegionId = currentCandidate.nextRegionId

    const regionCache = state.regionIntersectionCaches[nextRegionId]

    const newPair = this.buildDynamicAnglePair(
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
}
