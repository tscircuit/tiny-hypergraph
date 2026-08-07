import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { MinHeap } from "../MinHeap"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../core"
import {
  createRegionGraph,
  createRegionPathProblem,
  getSerializedRegionId,
  type RegionGraph,
  type RegionPathProblem,
} from "./graph"
import type { NetId, RegionId, RouteId } from "../types"
import { range } from "../utils"
import { visualizeRegionGraph } from "./visualizeRegionGraph"

export interface RegionPathSolverOptions {
  MM_COST_FOR_FULL_REGION?: number
  MAX_ITERATIONS?: number
  /** Enables topology-derived capacity in implementations that support it. */
  USE_TOPOLOGY_CAPACITY?: boolean
  MAX_NEGOTIATION_PASSES?: number
  SKIP_UNROUTABLE_ROUTES?: boolean
  USE_TOPOLOGY_CAPACITY?: boolean
}

export interface RegionPathCandidate {
  regionId: RegionId
  prevCandidate?: RegionPathCandidate
  prevRegionId?: RegionId
  prevEdgeId?: number
  g: number
  h: number
  f: number
}

export interface RegionPathSolverOutput {
  routeCount: number
  solvedRoutes: Array<{
    routeId: RouteId
    connectionId?: string
    startRegionId: string
    endRegionId: string
    regionIds: string[]
    cost: number
  }>
}

export interface RegionPathWorkingState {
  regionUsage: Int32Array
  regionAssignedRoutes: Array<RouteId[]>
  regionAssignedNets: Array<Set<NetId>>
  edgeUsage: Int32Array
  edgeAssignedNets: Array<Set<NetId>>
  regionHistoricalCost: Float64Array
  edgeHistoricalCost: Float64Array
  solvedRouteRegionIds: Array<RegionId[]>
  solvedRouteCosts: Float64Array
  currentRouteId: RouteId | undefined
  currentRouteNetId: NetId | undefined
  goalRegionId: RegionId
  unroutedRoutes: RouteId[]
  candidateQueue: MinHeap<RegionPathCandidate>
  candidateBestCostByRegionId: Float64Array
  candidateBestCostGenerationByRegionId: Uint32Array
  candidateBestCostGeneration: number
}

const compareCandidatesByF = (
  left: RegionPathCandidate,
  right: RegionPathCandidate,
) => left.f - right.f

export class RegionPathSolver extends BaseSolver {
  regionGraph: RegionGraph
  regionProblem: RegionPathProblem

  MM_COST_FOR_FULL_REGION = 20
  override MAX_ITERATIONS = 1e6
  USE_TOPOLOGY_CAPACITY = false
  MAX_NEGOTIATION_PASSES = 4
  SKIP_UNROUTABLE_ROUTES = false
  USE_TOPOLOGY_CAPACITY = false
  skippedRouteIds: RouteId[] = []
  negotiationPass = 0

  state: RegionPathWorkingState

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    options?: RegionPathSolverOptions,
  ) {
    super()

    this.regionGraph = createRegionGraph(topology)
    this.regionProblem = createRegionPathProblem(topology, problem)

    if (options?.MM_COST_FOR_FULL_REGION !== undefined) {
      this.MM_COST_FOR_FULL_REGION = options.MM_COST_FOR_FULL_REGION
    }
    if (options?.MAX_ITERATIONS !== undefined) {
      this.MAX_ITERATIONS = options.MAX_ITERATIONS
    }
    if (options?.USE_TOPOLOGY_CAPACITY !== undefined) {
      this.USE_TOPOLOGY_CAPACITY = options.USE_TOPOLOGY_CAPACITY
    }
    if (options?.MAX_NEGOTIATION_PASSES !== undefined) {
      this.MAX_NEGOTIATION_PASSES = options.MAX_NEGOTIATION_PASSES
    }
    if (options?.SKIP_UNROUTABLE_ROUTES !== undefined) {
      this.SKIP_UNROUTABLE_ROUTES = options.SKIP_UNROUTABLE_ROUTES
    }
    if (options?.USE_TOPOLOGY_CAPACITY !== undefined) {
      this.USE_TOPOLOGY_CAPACITY = options.USE_TOPOLOGY_CAPACITY
    }

    this.state = {
      regionUsage: new Int32Array(this.regionGraph.regionCount),
      regionAssignedRoutes: Array.from(
        { length: this.regionGraph.regionCount },
        () => [] as RouteId[],
      ),
      regionAssignedNets: Array.from(
        { length: this.regionGraph.regionCount },
        () => new Set<NetId>(),
      ),
      edgeUsage: new Int32Array(this.regionGraph.edgeCount),
      edgeAssignedNets: Array.from(
        { length: this.regionGraph.edgeCount },
        () => new Set<NetId>(),
      ),
      regionHistoricalCost: new Float64Array(this.regionGraph.regionCount),
      edgeHistoricalCost: new Float64Array(this.regionGraph.edgeCount),
      solvedRouteRegionIds: Array.from(
        { length: this.regionProblem.routeCount },
        () => [] as RegionId[],
      ),
      solvedRouteCosts: new Float64Array(this.regionProblem.routeCount),
      currentRouteId: undefined,
      currentRouteNetId: undefined,
      goalRegionId: -1,
      unroutedRoutes: range(this.regionProblem.routeCount),
      candidateQueue: new MinHeap([], compareCandidatesByF),
      candidateBestCostByRegionId: new Float64Array(
        this.regionGraph.regionCount,
      ),
      candidateBestCostGenerationByRegionId: new Uint32Array(
        this.regionGraph.regionCount,
      ),
      candidateBestCostGeneration: 1,
    }

    this.updateStats()
  }

  override _setup() {}

  override _step() {
    const { state, regionProblem } = this

    if (state.currentRouteId === undefined) {
      if (state.unroutedRoutes.length === 0) {
        if (
          this.hasOverloadedResources() &&
          this.negotiationPass < this.MAX_NEGOTIATION_PASSES
        ) {
          this.startNegotiationPass()
          return
        }
        this.solved = true
        this.updateStats()
        return
      }

      const nextRouteId = state.unroutedRoutes.shift()
      if (nextRouteId === undefined) {
        this.failed = true
        this.error = "Failed to pull the next route from the region-route queue"
        return
      }

      state.currentRouteId = nextRouteId
      state.currentRouteNetId = regionProblem.routeNet[nextRouteId]
      state.goalRegionId = regionProblem.routeEndRegion[nextRouteId]

      const startRegionId = regionProblem.routeStartRegion[nextRouteId]
      if (startRegionId === undefined || state.goalRegionId === undefined) {
        this.failed = true
        this.error = `Route ${nextRouteId} is missing region endpoints`
        return
      }

      state.candidateQueue.clear()
      this.resetCandidateBestCosts()

      const startCost = this.computeRegionEntryCost(startRegionId)
      const startCandidate: RegionPathCandidate = {
        regionId: startRegionId,
        g: startCost,
        h: 0,
        f: startCost,
      }

      this.setCandidateBestCost(startRegionId, startCost)
      state.candidateQueue.queue(startCandidate)
      this.updateStats()

      if (startRegionId === state.goalRegionId) {
        this.onPathFound(startCandidate)
        return
      }
    }

    const currentCandidate = state.candidateQueue.dequeue()

    if (!currentCandidate) {
      if (this.SKIP_UNROUTABLE_ROUTES) {
        if (state.currentRouteId !== undefined) {
          this.skippedRouteIds.push(state.currentRouteId)
        }
        state.currentRouteId = undefined
        state.currentRouteNetId = undefined
        state.goalRegionId = -1
        state.candidateQueue.clear()
        this.updateStats()
        return
      }
      this.failed = true
      this.error = `No region path found for route ${state.currentRouteId}`
      return
    }

    if (
      currentCandidate.g >
      this.getCandidateBestCost(currentCandidate.regionId) + Number.EPSILON
    ) {
      return
    }

    if (currentCandidate.regionId === state.goalRegionId) {
      this.onPathFound(currentCandidate)
      return
    }

    if (this.isRegionReservedForDifferentNet(currentCandidate.regionId)) {
      return
    }

    for (const edge of this.regionGraph.incidentEdges[
      currentCandidate.regionId
    ] ?? []) {
      const nextRegionId =
        edge.regionIdA === currentCandidate.regionId
          ? edge.regionIdB
          : edge.regionIdA

      if (this.isRegionReservedForDifferentNet(nextRegionId)) {
        continue
      }

      const g =
        currentCandidate.g +
        this.computeRegionEntryCost(nextRegionId) +
        this.computeEdgeEntryCost(edge.edgeId)
      if (!Number.isFinite(g)) {
        continue
      }

      if (g >= this.getCandidateBestCost(nextRegionId) - Number.EPSILON) {
        continue
      }

      const nextCandidate: RegionPathCandidate = {
        regionId: nextRegionId,
        prevRegionId: currentCandidate.regionId,
        prevEdgeId: edge.edgeId,
        prevCandidate: currentCandidate,
        g,
        h: 0,
        f: g,
      }

      this.setCandidateBestCost(nextRegionId, g)
      state.candidateQueue.queue(nextCandidate)
    }
  }

  resetCandidateBestCosts() {
    const { state } = this

    if (state.candidateBestCostGeneration === 0xffffffff) {
      state.candidateBestCostGenerationByRegionId.fill(0)
      state.candidateBestCostGeneration = 1
      return
    }

    state.candidateBestCostGeneration += 1
  }

  getCandidateBestCost(regionId: RegionId) {
    const { state } = this

    return state.candidateBestCostGenerationByRegionId[regionId] ===
      state.candidateBestCostGeneration
      ? state.candidateBestCostByRegionId[regionId]
      : Number.POSITIVE_INFINITY
  }

  setCandidateBestCost(regionId: RegionId, bestCost: number) {
    const { state } = this

    state.candidateBestCostGenerationByRegionId[regionId] =
      state.candidateBestCostGeneration
    state.candidateBestCostByRegionId[regionId] = bestCost
  }

  isRegionReservedForDifferentNet(regionId: RegionId) {
    const reservedNetId = this.regionProblem.regionNetId[regionId]
    return (
      reservedNetId !== -1 && reservedNetId !== this.state.currentRouteNetId
    )
  }

  computeRegionEntryCost(regionId: RegionId): number {
    const currentNetId = this.state.currentRouteNetId
    const nextUsage =
      this.state.regionUsage[regionId] +
      (currentNetId !== undefined &&
      this.state.regionAssignedNets[regionId]!.has(currentNetId)
        ? 0
        : 1)
    const regionCapacity = this.regionGraph.regionCapacity[regionId]
    const trackCapacity = this.getRegionCapacity(regionId)
    const overflow = Math.max(0, nextUsage - trackCapacity)
    return (
      (nextUsage / regionCapacity) * this.MM_COST_FOR_FULL_REGION +
      overflow * this.getOverCapacityCost() +
      this.state.regionHistoricalCost[regionId]
    )
  }

  computeEdgeEntryCost(edgeId: number): number {
    if (!this.USE_TOPOLOGY_CAPACITY) return 0

    const currentNetId = this.state.currentRouteNetId
    const nextUsage =
      this.state.edgeUsage[edgeId] +
      (currentNetId !== undefined &&
      this.state.edgeAssignedNets[edgeId]!.has(currentNetId)
        ? 0
        : 1)
    const edgeCapacity = this.regionGraph.edges[edgeId]!.portIds.length
    const overflow = Math.max(0, nextUsage - edgeCapacity)
    return (
      overflow * this.getOverCapacityCost() +
      this.state.edgeHistoricalCost[edgeId]
    )
  }

  getRegionCapacity(regionId: RegionId): number {
    return this.USE_TOPOLOGY_CAPACITY
      ? this.regionGraph.regionTrackCapacity[regionId]!
      : this.regionGraph.regionCapacity[regionId]!
  }

  getOverCapacityCost(): number {
    // A simple path visits at most one region and one boundary per graph hop.
    // This makes one overflow more expensive than any capacity-respecting path.
    return this.regionGraph.regionCount * this.MM_COST_FOR_FULL_REGION * 2
  }

  hasOverloadedResources(): boolean {
    if (!this.USE_TOPOLOGY_CAPACITY) return false

    for (let regionId = 0; regionId < this.regionGraph.regionCount; regionId++) {
      if (
        this.state.regionUsage[regionId] > this.getRegionCapacity(regionId)
      ) {
        return true
      }
    }
    for (const edge of this.regionGraph.edges) {
      if (this.state.edgeUsage[edge.edgeId] > edge.portIds.length) return true
    }
    return false
  }

  startNegotiationPass(): void {
    const { state, regionGraph, regionProblem } = this
    const overCapacityCost = this.getOverCapacityCost()
    for (let regionId = 0; regionId < regionGraph.regionCount; regionId++) {
      const overflow = Math.max(
        0,
        state.regionUsage[regionId] - this.getRegionCapacity(regionId),
      )
      state.regionHistoricalCost[regionId] += overflow * overCapacityCost
    }
    for (const edge of regionGraph.edges) {
      const overflow = Math.max(
        0,
        state.edgeUsage[edge.edgeId] - edge.portIds.length,
      )
      state.edgeHistoricalCost[edge.edgeId] += overflow * overCapacityCost
    }

    this.negotiationPass += 1
    state.regionUsage.fill(0)
    state.edgeUsage.fill(0)
    for (const routes of state.regionAssignedRoutes) routes.length = 0
    for (const nets of state.regionAssignedNets) nets.clear()
    for (const nets of state.edgeAssignedNets) nets.clear()
    for (const regionIds of state.solvedRouteRegionIds) regionIds.length = 0
    state.solvedRouteCosts.fill(0)
    state.currentRouteId = undefined
    state.currentRouteNetId = undefined
    state.goalRegionId = -1
    state.unroutedRoutes = range(regionProblem.routeCount)
    this.skippedRouteIds = []
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.updateStats()
  }

  getSolvedRegionPath(finalCandidate: RegionPathCandidate): RegionId[] {
    const regionPath: RegionId[] = []
    let cursor: RegionPathCandidate | undefined = finalCandidate

    while (cursor) {
      regionPath.unshift(cursor.regionId)
      cursor = cursor.prevCandidate
    }

    return regionPath
  }

  getSolvedEdgePath(finalCandidate: RegionPathCandidate): number[] {
    const edgePath: number[] = []
    let cursor: RegionPathCandidate | undefined = finalCandidate

    while (cursor) {
      if (cursor.prevEdgeId !== undefined) edgePath.unshift(cursor.prevEdgeId)
      cursor = cursor.prevCandidate
    }

    return edgePath
  }

  onPathFound(finalCandidate: RegionPathCandidate) {
    const { state } = this
    const currentRouteId = state.currentRouteId

    if (currentRouteId === undefined) {
      return
    }

    const solvedRegionPath = this.getSolvedRegionPath(finalCandidate)
    const solvedEdgePath = this.getSolvedEdgePath(finalCandidate)
    const routeNetId = this.regionProblem.routeNet[currentRouteId]!
    state.solvedRouteRegionIds[currentRouteId] = solvedRegionPath
    state.solvedRouteCosts[currentRouteId] = finalCandidate.g

    for (const regionId of solvedRegionPath) {
      if (!state.regionAssignedNets[regionId]!.has(routeNetId)) {
        state.regionAssignedNets[regionId]!.add(routeNetId)
        state.regionUsage[regionId] += 1
      }
      state.regionAssignedRoutes[regionId]!.push(currentRouteId)
    }
    for (const edgeId of solvedEdgePath) {
      if (!state.edgeAssignedNets[edgeId]!.has(routeNetId)) {
        state.edgeAssignedNets[edgeId]!.add(routeNetId)
        state.edgeUsage[edgeId] += 1
      }
    }

    state.currentRouteId = undefined
    state.currentRouteNetId = undefined
    state.goalRegionId = -1
    state.candidateQueue.clear()

    this.updateStats()
  }

  updateStats() {
    const { state, regionGraph } = this

    let maxRegionUsage = 0
    let maxUtilization = 0
    let maxEdgeUsage = 0
    let maxEdgeUtilization = 0

    for (let regionId = 0; regionId < regionGraph.regionCount; regionId++) {
      const usage = state.regionUsage[regionId]
      const utilization = usage / this.getRegionCapacity(regionId)
      maxRegionUsage = Math.max(maxRegionUsage, usage)
      maxUtilization = Math.max(maxUtilization, utilization)
    }
    for (let edgeId = 0; edgeId < regionGraph.edgeCount; edgeId++) {
      const usage = state.edgeUsage[edgeId]
      const utilization = usage / regionGraph.edges[edgeId]!.portIds.length
      maxEdgeUsage = Math.max(maxEdgeUsage, usage)
      maxEdgeUtilization = Math.max(maxEdgeUtilization, utilization)
    }

    this.stats = {
      ...this.stats,
      routeCount: this.regionProblem.routeCount,
      regionCount: regionGraph.regionCount,
      edgeCount: regionGraph.edgeCount,
      solvedRouteCount: state.solvedRouteRegionIds.filter(
        (regionPath) => regionPath.length > 0,
      ).length,
      currentRouteId: state.currentRouteId,
      currentGoalRegionId:
        state.goalRegionId >= 0 ? state.goalRegionId : undefined,
      openCandidateCount: state.candidateQueue.length,
      skippedRouteCount: this.skippedRouteIds.length,
      skippedRouteIds: [...this.skippedRouteIds],
      maxRegionUsage,
      maxUtilization,
      maxEdgeUsage,
      maxEdgeUtilization,
      negotiationPass: this.negotiationPass,
    }
  }

  override visualize(): GraphicsObject {
    return visualizeRegionGraph(this)
  }

  override getOutput(): RegionPathSolverOutput {
    return {
      routeCount: this.regionProblem.routeCount,
      solvedRoutes: this.state.solvedRouteRegionIds.map(
        (regionPath, routeId) => {
          const routeMetadata = this.regionProblem.routeMetadata?.[routeId] as
            | { connectionId?: unknown }
            | undefined
          return {
            routeId,
            connectionId:
              typeof routeMetadata?.connectionId === "string"
                ? routeMetadata.connectionId
                : undefined,
            startRegionId: getSerializedRegionId(
              this.regionGraph,
              this.regionProblem.routeStartRegion[routeId],
            ),
            endRegionId: getSerializedRegionId(
              this.regionGraph,
              this.regionProblem.routeEndRegion[routeId],
            ),
            regionIds: regionPath.map((regionId) =>
              getSerializedRegionId(this.regionGraph, regionId),
            ),
            cost: this.state.solvedRouteCosts[routeId] ?? 0,
          }
        },
      ),
    }
  }
}
