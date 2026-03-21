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
} from "./types"
import { computePortPositionOnBoundary } from "../hypergraph/lib/topology/utils"
import type { Region } from "@tscircuit/hypergraph"
import { countNewIntersections } from "./countNewIntersections"
import { computeRegionCost } from "./computeRegionCost"

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

  /** portSectionMask[portId] = true if port in section  */
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

  visitedPorts: Set<PortId>
  candidates: Candidate[]

  goalPortId: PortId
}

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  problemSetup: TinyHyperGraphProblemSetup

  DISTANCE_TO_COST = 0.05 // 50mm = 1 cost unit (1 cost unit ~ 100% chance of failure)

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
      unroutedRoutes: [],
      visitedPorts: new Set(),
      candidates: [],
      goalPortId: -1,
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

      state.visitedPorts.clear()
      const startingPortId = problem.routeStartPort[state.currentRouteId!]
      state.candidates = [
        {
          nextRegionId: topology.incidentPortRegion[startingPortId][0],
          portId: startingPortId,
          f: 0,
          g: 0,
          h: 0,
        },
      ]
      state.goalPortId = problem.routeEndPort[state.currentRouteId!]
    }

    const currentCandidate = state.candidates.pop()

    if (!currentCandidate) {
      this.failed = true
      this.error = "No candidates left"
      return
    }

    state.visitedPorts.add(currentCandidate.portId)

    const neighbors =
      topology.regionIncidentPorts[currentCandidate.nextRegionId]
    for (const neighborPortId of neighbors) {
      if (state.visitedPorts.has(neighborPortId)) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue

      if (neighborPortId === state.goalPortId) {
        this.onPathFound(currentCandidate)
        return
      }

      const g = this.computeG(currentCandidate, neighborPortId)
      const h = this.computeH(neighborPortId)

      state.candidates.push({
        nextRegionId: topology.incidentPortRegion[neighborPortId][0],
        portId: neighborPortId,
        g,
        h,
        f: g + h,
      })
    }
  }

  onPathFound(finalCandidate: Candidate) {
    const { topology, problem, state } = this
    // TODO if there were rips for this candidate, perform the rips etc.
    // TODO update the region cache to incorporate the new path and rips
    // TODO update the segments for involved regions
    state.currentRouteId = undefined
  }

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const { topology, problem, state } = this

    const nextRegionId = currentCandidate.nextRegionId

    const regionCache = state.regionIntersectionCaches[nextRegionId]

    const a = topology.portAngle[currentCandidate.portId]
    const z1 = topology.portZ[currentCandidate.portId]
    const b = topology.portAngle[neighborPortId]
    const z2 = topology.portZ[neighborPortId]

    let newPair: DynamicAnglePair
    if (a < b) {
      newPair = [state.currentRouteNetId!, a, z1, b, z2]
    } else {
      newPair = [state.currentRouteNetId!, b, z2, a, z1]
    }

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

    return currentCandidate.g + newRegionCost
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
