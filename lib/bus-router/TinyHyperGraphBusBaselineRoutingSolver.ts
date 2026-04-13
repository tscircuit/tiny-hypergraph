import type { GraphicsObject } from "graphics-debug"
import { convertToSerializedHyperGraph } from "../compat/convertToSerializedHyperGraph"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../core"
import { TinyHyperGraphSolver } from "../core"
import type { PortId, RegionId, RouteId } from "../types"
import { visualizeTinyGraph } from "../visualizeTinyGraph"

interface PendingCommitSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

export class TinyHyperGraphBusBaselineRoutingSolver extends TinyHyperGraphSolver {
  LAYER_CHANGE_COST = 0.25
  pendingCommitSegments: PendingCommitSegment[] = []

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    readonly busId: string,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  getActiveRouteLabel(routeId: RouteId | undefined) {
    if (routeId === undefined) {
      return undefined
    }

    const routeMetadata = this.problem.routeMetadata?.[routeId]
    return routeMetadata?.connectionId ?? `route-${routeId}`
  }

  getCompletedRouteCount() {
    if (this.solved) {
      return this.problem.routeCount
    }

    return (
      this.problem.routeCount -
      this.state.unroutedRoutes.length -
      (this.state.currentRouteId === undefined ? 0 : 1)
    )
  }

  initializeRoute(routeId: RouteId) {
    const { problem, state } = this

    state.currentRouteId = routeId
    state.currentRouteNetId = problem.routeNet[routeId]
    state.goalPortId = problem.routeEndPort[routeId]
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()

    const startingPortId = problem.routeStartPort[routeId]
    const startingNextRegionId = this.getStartingNextRegionId(
      routeId,
      startingPortId,
    )

    if (startingNextRegionId === undefined) {
      this.failed = true
      this.error = `Route "${this.getActiveRouteLabel(routeId)}" start port ${startingPortId} has no incident regions`
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
  }

  queueSolvedSegments(finalCandidate: Candidate) {
    this.pendingCommitSegments = this.getSolvedPathSegments(finalCandidate)
    this.state.candidateQueue.clear()

    if (this.pendingCommitSegments.length === 0) {
      this.state.currentRouteId = undefined
      this.state.currentRouteNetId = undefined
      this.state.goalPortId = -1
    }
  }

  commitNextSegment() {
    const currentRouteId = this.state.currentRouteId
    const currentRouteNetId = this.state.currentRouteNetId
    const nextSegment = this.pendingCommitSegments.shift()

    if (
      !nextSegment ||
      currentRouteId === undefined ||
      currentRouteNetId === undefined
    ) {
      return
    }

    this.state.regionSegments[nextSegment.regionId]!.push([
      currentRouteId,
      nextSegment.fromPortId,
      nextSegment.toPortId,
    ])
    this.state.portAssignment[nextSegment.fromPortId] = currentRouteNetId
    this.state.portAssignment[nextSegment.toPortId] = currentRouteNetId
    this.appendSegmentToRegionCache(
      nextSegment.regionId,
      nextSegment.fromPortId,
      nextSegment.toPortId,
    )

    if (this.pendingCommitSegments.length === 0) {
      this.state.currentRouteId = undefined
      this.state.currentRouteNetId = undefined
      this.state.goalPortId = -1
    }
  }

  override _step() {
    const { problem, topology, state } = this

    if (this.pendingCommitSegments.length > 0) {
      this.commitNextSegment()
      return
    }

    if (state.currentRouteId === undefined) {
      const nextRouteId = state.unroutedRoutes.shift()

      if (nextRouteId === undefined) {
        this.onAllRoutesRouted()
        return
      }

      this.initializeRoute(nextRouteId)
      return
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
      topology.regionIncidentPorts[currentCandidate.nextRegionId] ?? []

    for (const neighborPortId of neighbors) {
      const assignedNetId = state.portAssignment[neighborPortId]

      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
        continue
      }
      if (neighborPortId === currentCandidate.portId) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue

      if (neighborPortId === state.goalPortId) {
        this.queueSolvedSegments(currentCandidate)
        return
      }

      const g = this.computeG(currentCandidate, neighborPortId)
      if (!Number.isFinite(g)) continue
      const h = this.computeH(neighborPortId)

      const nextRegionId =
        topology.incidentPortRegion[neighborPortId]?.[0] ===
        currentCandidate.nextRegionId
          ? topology.incidentPortRegion[neighborPortId]?.[1]
          : topology.incidentPortRegion[neighborPortId]?.[0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNet(nextRegionId)
      ) {
        continue
      }

      const candidate: Candidate = {
        prevRegionId: currentCandidate.nextRegionId,
        nextRegionId,
        portId: neighborPortId,
        g,
        h,
        f: g + h,
        prevCandidate: currentCandidate,
      }
      const candidateHopId = this.getHopId(neighborPortId, nextRegionId)

      if (g >= this.getCandidateBestCost(candidateHopId)) continue

      this.setCandidateBestCost(candidateHopId, g)
      state.candidateQueue.queue(candidate)
    }
  }

  override computeG(currentCandidate: Candidate, neighborPortId: PortId) {
    const dx =
      this.topology.portX[currentCandidate.portId] -
      this.topology.portX[neighborPortId]
    const dy =
      this.topology.portY[currentCandidate.portId] -
      this.topology.portY[neighborPortId]
    const layerChangeCost =
      this.topology.portZ[currentCandidate.portId] ===
      this.topology.portZ[neighborPortId]
        ? 0
        : this.LAYER_CHANGE_COST

    return (
      currentCandidate.g +
      Math.hypot(dx, dy) * this.DISTANCE_TO_COST +
      layerChangeCost
    )
  }

  override onAllRoutesRouted() {
    this.stats = {
      ...this.stats,
      baselineRouteCount: this.problem.routeCount,
      maxRegionCost: getMaxRegionCost(this),
    }
    this.solved = true
  }

  override onOutOfCandidates() {
    this.failed = true
    this.error = `Bus baseline routing ran out of candidates while routing "${this.getActiveRouteLabel(this.state.currentRouteId)}"`
  }

  override visualize(): GraphicsObject {
    const graphics = visualizeTinyGraph(this)
    const activeRouteLabel = this.getActiveRouteLabel(this.state.currentRouteId)
    const stageStatus =
      this.pendingCommitSegments.length > 0
        ? `committing=${this.pendingCommitSegments.length}`
        : activeRouteLabel
          ? `routing=${activeRouteLabel}`
          : "waiting"

    graphics.title = [
      "Bus Baseline Routing",
      `bus=${this.busId}`,
      stageStatus,
      `done=${this.getCompletedRouteCount()}/${this.problem.routeCount}`,
      this.failed ? "failed" : this.solved ? "solved" : "running",
    ].join(" | ")

    return graphics
  }

  override getOutput(): SerializedHyperGraph {
    return convertToSerializedHyperGraph(this)
  }
}
