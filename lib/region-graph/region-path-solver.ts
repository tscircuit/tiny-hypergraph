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
}

export interface RegionPathCandidate {
  regionId: RegionId
  prevCandidate?: RegionPathCandidate
  prevRegionId?: RegionId
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

    this.state = {
      regionUsage: new Int32Array(this.regionGraph.regionCount),
      regionAssignedRoutes: Array.from(
        { length: this.regionGraph.regionCount },
        () => [] as RouteId[],
      ),
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

      const g = currentCandidate.g + this.computeRegionEntryCost(nextRegionId)
      if (!Number.isFinite(g)) {
        continue
      }

      if (g >= this.getCandidateBestCost(nextRegionId) - Number.EPSILON) {
        continue
      }

      const nextCandidate: RegionPathCandidate = {
        regionId: nextRegionId,
        prevRegionId: currentCandidate.regionId,
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

  computeRegionEntryCost(regionId: RegionId) {
    const nextUsage = this.state.regionUsage[regionId] + 1
    const regionCapacity = this.regionGraph.regionCapacity[regionId]
    return (nextUsage / regionCapacity) * this.MM_COST_FOR_FULL_REGION
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

  onPathFound(finalCandidate: RegionPathCandidate) {
    const { state } = this
    const currentRouteId = state.currentRouteId

    if (currentRouteId === undefined) {
      return
    }

    const solvedRegionPath = this.getSolvedRegionPath(finalCandidate)
    state.solvedRouteRegionIds[currentRouteId] = solvedRegionPath
    state.solvedRouteCosts[currentRouteId] = finalCandidate.g

    for (const regionId of solvedRegionPath) {
      state.regionUsage[regionId] += 1
      state.regionAssignedRoutes[regionId]!.push(currentRouteId)
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

    for (let regionId = 0; regionId < regionGraph.regionCount; regionId++) {
      const usage = state.regionUsage[regionId]
      const utilization = usage / regionGraph.regionCapacity[regionId]
      maxRegionUsage = Math.max(maxRegionUsage, usage)
      maxUtilization = Math.max(maxUtilization, utilization)
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
      maxRegionUsage,
      maxUtilization,
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
