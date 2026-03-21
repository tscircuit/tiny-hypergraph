import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { visualizeTinyGraph } from "./visualizeTinyGraph"
import type {
  PortId,
  RegionId,
  Integer,
  RouteId,
  DynamicAnglePair,
  DynamicAnglePairArrays,
  RegionIntersectionCache,
  NetId,
  SegmentId,
} from "./types"
import { computePortPositionOnBoundary } from "../hypergraph/lib/topology/utils"
import type { Region } from "@tscircuit/hypergraph"
import { countNewIntersections } from "./countNewIntersections"
import { computeRegionCost } from "./computeRegionCost"
import { range } from "./utils"

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

  RIP_CONGESTION_REGION_COST = 0.05

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
        () => ({
          netIds: new Int32Array(0),
          lesserAngles: new Int32Array(0),
          greaterAngles: new Int32Array(0),
          layerMasks: new Int32Array(0),
          existingCrossingLayerIntersections: 0,
          existingSameLayerIntersections: 0,
          existingEntryExitLayerChanges: 0,
          existingRegionCost: 0,
        }),
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
        this.solved = true
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
      if (state.portAssignment[neighborPortId] !== -1) continue
      if (state.visitedSegments.has(segmentIdPart1 + neighborPortId)) continue
      if (neighborPortId === currentCandidate.portId) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue

      if (neighborPortId === state.goalPortId) {
        this.onPathFound(currentCandidate)
        return
      }

      const g = this.computeG(currentCandidate, neighborPortId)
      const h = this.computeH(neighborPortId)

      let nextRegionId =
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

  onAllRoutesRouted() {
    const currentRipThreshold =
      this.RIP_THRESHOLD_START +
      (this.RIP_THRESHOLD_END - this.RIP_THRESHOLD_START) *
        Math.max(1, state.ripCount / this.RIP_THRESHOLD_RAMP_ATTEMPTS)

    // TODO check the cost of each region, if all regions are below the
    // currentRipThreshold then we're done and we can mark this.solved = true
    // If there's even one region that is > currentRipThreshold, we restart
    // the entire solver, zero'ing out everything accept the congestion costs
    // and shuffle the unroutedRoutes
    // When ripping, we add the RIP_CONGESTION_REGION_COST to each region
    //       that has regionCost > currentRipThreshold
    //
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
    const { topology, problem, state } = this

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
