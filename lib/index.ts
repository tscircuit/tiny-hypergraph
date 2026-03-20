import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { visualizeTinyGraph } from "./visualizeTinyGraph"
import type { PortId, RegionId, Integer, RouteId } from "./types"

export interface TinyHyperGraphTopology {
  portCount: number
  regionCount: number

  /** regionIncidentPorts[regionId] = list of port ids incident to the region */
  regionIncidentPorts: PortId[][]

  /** incidentPortRegion[portId] = list of region ids incident to the port */
  incidentPortRegion: RegionId[][]

  regionWidth?: Float64Array[]
  regionHeight?: Float64Array[]
  regionCenterX?: Float64Array[]
  regionCenterY?: Float64Array[]

  /** regionMetadata[regionId] = metadata for the region */
  regionMetadata?: any[]

  /** portAngle[portId] = CCW angle of the port where 0 is the right side, 90 is the top, used for fast intersection calculations */
  portAngle?: Float64Array[]
  portX: Float64Array[]
  portY: Float64Array[]
  portZ: Int32Array[]

  portMetadata?: any[]
}
export interface TinyHyperGraphProblem {
  /** portSectionMask[portId] = true if port in section  */
  portSectionMask: Int8Array // boolean[], length: portCount

  /** routeMetadata[routeId] = metadata for the route */
  routeMetadata?: any[]

  /** routeStartRegion[routeId] = list of port ids at the start of the route */
  routeStartPort: Int32Array // PortId[]
  routeEndPort: Int32Array // PortId[]
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

  currentRouteId: RouteId | undefined

  unroutedRoutes: RouteId[]

  visitedPorts: Set<PortId>
  candidates: Candidate[]

  goalPortId: PortId
}

export class TinyHyperGraphSolver extends BaseSolver {
  state: TinyHyperGraphWorkingState
  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
  ) {
    super()
    this.state = {
      portAssignment: new Int32Array(topology.portCount).fill(-1),
      regionSegments: Array.from({ length: topology.regionCount }, () => []),
      currentRouteId: undefined,
      unroutedRoutes: [],
      visitedPorts: new Set(),
      candidates: [],
      goalPortId: -1,
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

  computeG(currentCandidate: Candidate, neighborPortId: PortId): number {
    const { topology, problem, state } = this
  }

  computeH(neighborPortId: PortId): number {
    const nx = this.topology.portX[neighborPortId]
    const ny = this.topology.portY[neighborPortId]

    const gx = this.topology.portX[this.state.goalPortId]
    const gy = this.topology.portY[this.state.goalPortId]

    return Math.sqrt((nx - gx) ** 2 + (ny - gy) ** 2)
  }

  override visualize(): GraphicsObject {
    return visualizeTinyGraph(this)
  }
}
