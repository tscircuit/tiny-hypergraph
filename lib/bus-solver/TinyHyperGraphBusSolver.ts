import type { GraphicsObject } from "graphics-debug"
import { MinHeap } from "../MinHeap"
import {
  type Candidate,
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { NetId, PortId, RegionId, RouteId } from "../types"
import { visualizeTinyGraph } from "../visualizeTinyGraph"
import { deriveBusTraceOrder, type BusTraceOrder } from "./deriveBusTraceOrder"
import {
  doSegmentsConflict,
  getDistanceFromPortToPolyline,
  getPortDistance,
  getPortProjection,
} from "./geometry"

export interface TinyHyperGraphBusSolverOptions
  extends TinyHyperGraphSolverOptions {
  BUS_TRACE_SEPARATION?: number
}

interface BusTraceState {
  routeId: RouteId
  portId: PortId
  nextRegionId?: RegionId
  atGoal: boolean
  prevState?: BusTraceState
}

interface TraceSearchCandidate {
  state: BusTraceState
  g: number
  h: number
  f: number
}

interface ActiveTraceSearch {
  traceIndex: number
  routeId: RouteId
  candidateQueue: MinHeap<TraceSearchCandidate>
  bestCostByTraceState: Map<string, number>
}

interface BusSolveState {
  phase: "center" | "outer" | "done"
  currentOuterTraceCursor: number
  centerlinePortIds?: PortId[]
  reservedPortIds: Set<PortId>
  solvedTraceStates: Array<BusTraceState | undefined>
  solvedTraceCosts: Float64Array
  activeTraceSearch?: ActiveTraceSearch
  lastExpandedCandidate?: TraceSearchCandidate
}

const BUS_CANDIDATE_EPSILON = 1e-9

const compareTraceCandidates = (
  left: TraceSearchCandidate,
  right: TraceSearchCandidate,
) => left.f - right.f || left.h - right.h || left.g - right.g

export class TinyHyperGraphBusSolver extends TinyHyperGraphSolver {
  BUS_TRACE_SEPARATION = 0.1
  BUS_ALIGNMENT_COST_FACTOR = 0.2
  BUS_HEURISTIC_WEIGHT = 1.5

  readonly busTraceOrder: BusTraceOrder

  private readonly centerTraceIndex: number
  private readonly outerTraceIndices: number[]

  private busState: BusSolveState

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphBusSolverOptions,
  ) {
    super(topology, problem, options)

    if (options?.BUS_TRACE_SEPARATION !== undefined) {
      this.BUS_TRACE_SEPARATION = options.BUS_TRACE_SEPARATION
    }

    this.busTraceOrder = deriveBusTraceOrder(topology, problem)
    this.centerTraceIndex = this.busTraceOrder.centerTraceIndex
    this.outerTraceIndices = this.busTraceOrder.traces
      .map((trace) => trace.orderIndex)
      .filter((traceIndex) => traceIndex !== this.centerTraceIndex)
      .sort((leftIndex, rightIndex) => {
        const leftTrace = this.busTraceOrder.traces[leftIndex]!
        const rightTrace = this.busTraceOrder.traces[rightIndex]!
        return (
          leftTrace.distanceFromCenter - rightTrace.distanceFromCenter ||
          leftTrace.signedIndexFromCenter - rightTrace.signedIndexFromCenter
        )
      })

    this.busState = this.createInitialBusState()
    this.updateBusStats()
  }

  override _setup() {
    this.resetCommittedSolution()
    void this.problemSetup
    this.busState = this.createInitialBusState()
    this.updateBusStats()
  }

  override _step() {
    if (!this.busState.activeTraceSearch) {
      this.startNextTraceSearch()

      if (this.solved || this.failed) {
        this.updateBusStats()
        return
      }
    }

    const activeTraceSearch = this.busState.activeTraceSearch
    if (!activeTraceSearch) {
      this.failed = true
      this.error = "Failed to start the next bus-trace search"
      this.updateBusStats()
      return
    }

    const currentCandidate = activeTraceSearch.candidateQueue.dequeue()
    this.busState.lastExpandedCandidate = currentCandidate

    if (!currentCandidate) {
      this.failed = true
      this.error = `No path found for bus trace ${this.getTraceConnectionId(activeTraceSearch.traceIndex)}`
      this.updateBusStats()
      return
    }

    const currentBestCost = activeTraceSearch.bestCostByTraceState.get(
      this.getTraceStateKey(currentCandidate.state),
    )
    if (
      currentBestCost !== undefined &&
      currentCandidate.g > currentBestCost + BUS_CANDIDATE_EPSILON
    ) {
      this.updateBusStats(currentCandidate)
      return
    }

    if (currentCandidate.state.atGoal) {
      this.finalizeSolvedTrace(
        activeTraceSearch.traceIndex,
        currentCandidate.state,
        currentCandidate.g,
      )
      this.updateBusStats(currentCandidate)
      return
    }

    for (const move of this.getAvailableTraceMoves(currentCandidate.state)) {
      if (
        this.isMoveBlockedByBusConstraints(activeTraceSearch.traceIndex, move)
      ) {
        continue
      }

      let nextG =
        currentCandidate.g + move.segmentLength * this.DISTANCE_TO_COST
      if (activeTraceSearch.traceIndex !== this.centerTraceIndex) {
        nextG +=
          this.computeTraceAlignmentCost(
            activeTraceSearch.traceIndex,
            this.busState.centerlinePortIds!,
            move.nextState.portId,
          ) * this.BUS_ALIGNMENT_COST_FACTOR
      }

      const nextH = this.computeTraceHeuristic(move.nextState)
      const nextF =
        nextG +
        nextH *
          (activeTraceSearch.traceIndex === this.centerTraceIndex
            ? 1
            : this.BUS_HEURISTIC_WEIGHT)

      const nextStateKey = this.getTraceStateKey(move.nextState)
      const existingBestCost =
        activeTraceSearch.bestCostByTraceState.get(nextStateKey)

      if (
        existingBestCost !== undefined &&
        nextG >= existingBestCost - BUS_CANDIDATE_EPSILON
      ) {
        continue
      }

      activeTraceSearch.bestCostByTraceState.set(nextStateKey, nextG)
      activeTraceSearch.candidateQueue.queue({
        state: move.nextState,
        g: nextG,
        h: nextH,
        f: nextF,
      })
    }

    this.updateBusStats(currentCandidate)
  }

  override visualize(): GraphicsObject {
    const activeRouteId =
      this.busState.activeTraceSearch?.routeId ??
      this.busState.lastExpandedCandidate?.state.routeId

    if (this.iterations === 0 || activeRouteId === undefined || this.solved) {
      return visualizeTinyGraph(this)
    }

    const previousCurrentRouteId = this.state.currentRouteId
    const previousCurrentRouteNetId = this.state.currentRouteNetId
    const previousGoalPortId = this.state.goalPortId
    const previousCandidateQueue = this.state.candidateQueue
    const previousUnroutedRoutes = this.state.unroutedRoutes

    try {
      this.state.currentRouteId = activeRouteId
      this.state.currentRouteNetId = this.problem.routeNet[activeRouteId]
      this.state.goalPortId = this.problem.routeEndPort[activeRouteId]!
      this.state.candidateQueue = new MinHeap<Candidate>(
        this.getVisualizationCandidates(activeRouteId),
        (left, right) =>
          left.f - right.f || left.h - right.h || left.g - right.g,
      )
      this.state.unroutedRoutes =
        this.getVisualizationUnroutedRouteIds(activeRouteId)

      const graphics = visualizeTinyGraph(this)
      this.pushActiveCandidateOverlay(graphics)
      return graphics
    } finally {
      this.state.currentRouteId = previousCurrentRouteId
      this.state.currentRouteNetId = previousCurrentRouteNetId
      this.state.goalPortId = previousGoalPortId
      this.state.candidateQueue = previousCandidateQueue
      this.state.unroutedRoutes = previousUnroutedRoutes
    }
  }

  private createInitialBusState(): BusSolveState {
    return {
      phase: "center",
      currentOuterTraceCursor: 0,
      centerlinePortIds: undefined,
      reservedPortIds: new Set(),
      solvedTraceStates: Array.from(
        { length: this.problem.routeCount },
        () => undefined as BusTraceState | undefined,
      ),
      solvedTraceCosts: new Float64Array(this.problem.routeCount),
      activeTraceSearch: undefined,
      lastExpandedCandidate: undefined,
    }
  }

  private getVisualizationCandidates(activeRouteId: RouteId) {
    const candidates: Candidate[] = []

    if (
      this.busState.lastExpandedCandidate &&
      this.busState.lastExpandedCandidate.state.routeId === activeRouteId
    ) {
      candidates.push(
        this.convertTraceSearchCandidateToVisualizationCandidate(
          this.busState.lastExpandedCandidate,
        ),
      )
    }

    for (const candidate of this.busState.activeTraceSearch?.candidateQueue.toArray() ??
      []) {
      candidates.push(
        this.convertTraceSearchCandidateToVisualizationCandidate(candidate),
      )
    }

    return candidates
  }

  private getVisualizationUnroutedRouteIds(activeRouteId: RouteId) {
    const remainingRouteIds: RouteId[] = []

    for (
      let traceIndex = 0;
      traceIndex < this.busTraceOrder.traces.length;
      traceIndex++
    ) {
      if (this.busState.solvedTraceStates[traceIndex]) {
        continue
      }

      const routeId = this.busTraceOrder.traces[traceIndex]!.routeId
      if (routeId === activeRouteId) {
        continue
      }

      remainingRouteIds.push(routeId)
    }

    return remainingRouteIds
  }

  private convertTraceSearchCandidateToVisualizationCandidate(
    candidate: TraceSearchCandidate,
  ): Candidate {
    const visualizationCandidate =
      this.convertTraceStateToVisualizationCandidate(candidate.state)

    visualizationCandidate.g = candidate.g
    visualizationCandidate.h = candidate.h
    visualizationCandidate.f = candidate.f

    return visualizationCandidate
  }

  private convertTraceStateToVisualizationCandidate(
    traceState: BusTraceState,
  ): Candidate {
    return {
      portId: traceState.portId,
      nextRegionId:
        traceState.nextRegionId ?? traceState.prevState?.nextRegionId ?? -1,
      prevRegionId: traceState.prevState?.nextRegionId,
      prevCandidate: traceState.prevState
        ? this.convertTraceStateToVisualizationCandidate(traceState.prevState)
        : undefined,
      g: 0,
      h: 0,
      f: 0,
    }
  }

  private startNextTraceSearch() {
    while (!this.busState.activeTraceSearch && !this.solved && !this.failed) {
      if (this.busState.phase === "center") {
        this.initializeTraceSearch(this.centerTraceIndex)
        return
      }

      if (this.busState.phase === "outer") {
        if (
          this.busState.currentOuterTraceCursor >= this.outerTraceIndices.length
        ) {
          this.busState.phase = "done"
          this.solved = true
          return
        }

        const traceIndex =
          this.outerTraceIndices[this.busState.currentOuterTraceCursor]!
        this.initializeTraceSearch(traceIndex)
        return
      }

      if (this.busState.phase === "done") {
        this.solved = true
        return
      }
    }
  }

  private initializeTraceSearch(traceIndex: number) {
    const routeId = this.busTraceOrder.traces[traceIndex]!.routeId
    const startState = this.createStartingTraceState(routeId)
    const startPortId = this.problem.routeStartPort[routeId]!
    const goalPortId = this.problem.routeEndPort[routeId]!

    if (
      traceIndex !== this.centerTraceIndex &&
      (this.busState.reservedPortIds.has(startPortId) ||
        this.busState.reservedPortIds.has(goalPortId))
    ) {
      this.failed = true
      this.error = `Bus trace ${this.getTraceConnectionId(traceIndex)} starts or ends on a reserved port`
      return
    }

    if (startState.atGoal) {
      this.finalizeSolvedTrace(traceIndex, startState, 0)
      return
    }

    const candidateQueue = new MinHeap<TraceSearchCandidate>(
      [],
      compareTraceCandidates,
    )
    const bestCostByTraceState = new Map<string, number>()
    const startH = this.computeTraceHeuristic(startState)

    candidateQueue.queue({
      state: startState,
      g: 0,
      h: startH,
      f:
        startH *
        (traceIndex === this.centerTraceIndex ? 1 : this.BUS_HEURISTIC_WEIGHT),
    })
    bestCostByTraceState.set(this.getTraceStateKey(startState), 0)

    this.busState.activeTraceSearch = {
      traceIndex,
      routeId,
      candidateQueue,
      bestCostByTraceState,
    }
  }

  private resetCommittedSolution() {
    const { topology, state } = this

    state.portAssignment.fill(-1)
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
    state.unroutedRoutes = []
    state.candidateQueue.clear()
    state.goalPortId = -1
    state.ripCount = 0
    state.regionCongestionCost.fill(0)
  }

  private createStartingTraceState(routeId: RouteId): BusTraceState {
    const startPortId = this.problem.routeStartPort[routeId]!
    const goalPortId = this.problem.routeEndPort[routeId]!

    if (startPortId === goalPortId) {
      return {
        routeId,
        portId: startPortId,
        atGoal: true,
      }
    }

    const nextRegionId = this.getStartingNextRegionId(routeId, startPortId)
    if (nextRegionId === undefined) {
      throw new Error(`Bus route ${routeId} has no incident start region`)
    }

    return {
      routeId,
      portId: startPortId,
      nextRegionId,
      atGoal: false,
    }
  }

  private getAvailableTraceMoves(traceState: BusTraceState) {
    if (traceState.atGoal || traceState.nextRegionId === undefined) {
      return [] as Array<{
        nextState: BusTraceState
        segmentLength: number
      }>
    }

    const routeId = traceState.routeId
    const goalPortId = this.problem.routeEndPort[routeId]!
    const currentNetId = this.problem.routeNet[routeId]!
    const currentRegionId = traceState.nextRegionId
    const moves: Array<{
      nextState: BusTraceState
      segmentLength: number
    }> = []

    for (const neighborPortId of this.topology.regionIncidentPorts[
      currentRegionId
    ] ?? []) {
      if (neighborPortId === traceState.portId) {
        continue
      }

      if (this.problem.portSectionMask[neighborPortId] === 0) {
        continue
      }

      if (this.isPortReservedForDifferentBusNet(currentNetId, neighborPortId)) {
        continue
      }

      const segmentLength = getPortDistance(
        this.topology,
        traceState.portId,
        neighborPortId,
      )

      if (neighborPortId === goalPortId) {
        moves.push({
          nextState: {
            routeId,
            portId: goalPortId,
            atGoal: true,
            prevState: traceState,
          },
          segmentLength,
        })
        continue
      }

      const nextRegionId =
        this.topology.incidentPortRegion[neighborPortId]?.[0] ===
        currentRegionId
          ? this.topology.incidentPortRegion[neighborPortId]?.[1]
          : this.topology.incidentPortRegion[neighborPortId]?.[0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentBusNet(currentNetId, nextRegionId)
      ) {
        continue
      }

      moves.push({
        nextState: {
          routeId,
          portId: neighborPortId,
          nextRegionId,
          atGoal: false,
          prevState: traceState,
        },
        segmentLength,
      })
    }

    return moves
  }

  private isMoveBlockedByBusConstraints(
    traceIndex: number,
    move: { nextState: BusTraceState; segmentLength: number },
  ) {
    if (this.busState.reservedPortIds.has(move.nextState.portId)) {
      return true
    }

    if (traceIndex === this.centerTraceIndex) {
      return false
    }

    const centerlinePortIds = this.busState.centerlinePortIds
    if (!centerlinePortIds || centerlinePortIds.length === 0) {
      return true
    }

    const centerPortId = centerlinePortIds[centerlinePortIds.length - 1]
    const traceMetadata = this.busTraceOrder.traces[traceIndex]!
    const fromPortId = move.nextState.prevState?.portId

    if (centerPortId === undefined || fromPortId === undefined) {
      return true
    }

    if (
      !this.isPortOnExpectedSideOfCenterline(
        traceMetadata.signedIndexFromCenter,
        centerPortId,
        move.nextState.portId,
      )
    ) {
      return true
    }

    return this.doesTraceMoveIntersectCenterline(
      fromPortId,
      move.nextState.portId,
      centerlinePortIds,
    )
  }

  private isPortOnExpectedSideOfCenterline(
    signedIndexFromCenter: number,
    centerPortId: PortId,
    candidatePortId: PortId,
  ) {
    if (signedIndexFromCenter === 0) {
      return true
    }

    const centerProjection = getPortProjection(
      this.topology,
      centerPortId,
      this.busTraceOrder.normalX,
      this.busTraceOrder.normalY,
    )
    const candidateProjection = getPortProjection(
      this.topology,
      candidatePortId,
      this.busTraceOrder.normalX,
      this.busTraceOrder.normalY,
    )

    return signedIndexFromCenter < 0
      ? candidateProjection <= centerProjection + BUS_CANDIDATE_EPSILON
      : candidateProjection >= centerProjection - BUS_CANDIDATE_EPSILON
  }

  private doesTraceMoveIntersectCenterline(
    fromPortId: PortId,
    toPortId: PortId,
    centerlinePortIds: readonly PortId[],
  ) {
    for (let index = 1; index < centerlinePortIds.length; index++) {
      if (
        doSegmentsConflict(
          this.topology,
          fromPortId,
          toPortId,
          centerlinePortIds[index - 1]!,
          centerlinePortIds[index]!,
        )
      ) {
        return true
      }
    }

    return false
  }

  private computeTraceAlignmentCost(
    traceIndex: number,
    centerlinePortIds: readonly PortId[],
    candidatePortId: PortId,
  ) {
    const traceMetadata = this.busTraceOrder.traces[traceIndex]!
    const targetDistance =
      this.BUS_TRACE_SEPARATION * traceMetadata.distanceFromCenter
    const actualDistance = getDistanceFromPortToPolyline(
      this.topology,
      candidatePortId,
      centerlinePortIds,
    )

    return Math.abs(actualDistance - targetDistance)
  }

  private computeTraceHeuristic(traceState: BusTraceState) {
    if (traceState.atGoal) {
      return 0
    }

    return this.problemSetup.portHCostToEndOfRoute[
      traceState.portId * this.problem.routeCount + traceState.routeId
    ]
  }

  private isPortReservedForDifferentBusNet(
    currentNetId: NetId,
    portId: PortId,
  ) {
    const reservedNetIds = this.problemSetup.portEndpointNetIds[portId]
    if (!reservedNetIds) {
      return false
    }

    for (const reservedNetId of reservedNetIds) {
      if (reservedNetId !== currentNetId) {
        return true
      }
    }

    return false
  }

  private isRegionReservedForDifferentBusNet(
    currentNetId: NetId,
    regionId: RegionId,
  ) {
    const reservedNetId = this.problem.regionNetId[regionId]
    return reservedNetId !== -1 && reservedNetId !== currentNetId
  }

  private getTracePathPortIds(traceState: BusTraceState) {
    const portIds: PortId[] = []
    let cursor: BusTraceState | undefined = traceState

    while (cursor) {
      portIds.unshift(cursor.portId)
      cursor = cursor.prevState
    }

    return portIds
  }

  private getTraceSegments(traceState: BusTraceState) {
    const pathStates: BusTraceState[] = []
    let cursor: BusTraceState | undefined = traceState

    while (cursor) {
      pathStates.unshift(cursor)
      cursor = cursor.prevState
    }

    const segments: Array<{
      regionId: RegionId
      fromPortId: PortId
      toPortId: PortId
    }> = []

    for (let index = 1; index < pathStates.length; index++) {
      const previousState = pathStates[index - 1]!
      const currentState = pathStates[index]!

      if (previousState.nextRegionId === undefined) {
        throw new Error(
          `Bus route ${traceState.routeId} is missing a region before port ${currentState.portId}`,
        )
      }

      segments.push({
        regionId: previousState.nextRegionId,
        fromPortId: previousState.portId,
        toPortId: currentState.portId,
      })
    }

    return segments
  }

  private commitSolvedTrace(traceState: BusTraceState) {
    const routeId = traceState.routeId
    const routeNetId = this.problem.routeNet[routeId]!
    const previousRouteId = this.state.currentRouteId
    const previousRouteNetId = this.state.currentRouteNetId

    this.state.currentRouteId = routeId
    this.state.currentRouteNetId = routeNetId

    for (const segment of this.getTraceSegments(traceState)) {
      this.state.regionSegments[segment.regionId]!.push([
        routeId,
        segment.fromPortId,
        segment.toPortId,
      ])
      this.state.portAssignment[segment.fromPortId] = routeNetId
      this.state.portAssignment[segment.toPortId] = routeNetId
      this.appendSegmentToRegionCache(
        segment.regionId,
        segment.fromPortId,
        segment.toPortId,
      )
    }

    this.state.currentRouteId = previousRouteId
    this.state.currentRouteNetId = previousRouteNetId
  }

  private getPortRenderPoint(portId: PortId) {
    const layerOffset = this.topology.portZ[portId] * 0.002

    return {
      x: this.topology.portX[portId] + layerOffset,
      y: this.topology.portY[portId] + layerOffset,
    }
  }

  private pushActiveCandidateOverlay(graphics: GraphicsObject) {
    const activeCandidate = this.busState.lastExpandedCandidate
    if (!activeCandidate) {
      return
    }

    const activeRouteConnectionId =
      this.problem.routeMetadata?.[activeCandidate.state.routeId]
        ?.connectionId ?? `route-${activeCandidate.state.routeId}`

    const activePathPoints: Array<{ x: number; y: number }> = []
    let cursor: BusTraceState | undefined = activeCandidate.state

    while (cursor) {
      activePathPoints.unshift(this.getPortRenderPoint(cursor.portId))
      cursor = cursor.prevState
    }

    if (activePathPoints.length > 1) {
      graphics.lines ??= []
      graphics.lines.push({
        points: activePathPoints,
        strokeColor: "rgba(16, 185, 129, 0.95)",
        label: [
          "active candidate",
          `route: ${activeRouteConnectionId}`,
          `g: ${activeCandidate.g.toFixed(2)}`,
          `h: ${activeCandidate.h.toFixed(2)}`,
          `f: ${activeCandidate.f.toFixed(2)}`,
        ].join("\n"),
      })
    }

    graphics.points ??= []
    graphics.points.push({
      ...this.getPortRenderPoint(activeCandidate.state.portId),
      color: "rgba(16, 185, 129, 1)",
      label: [
        "active candidate",
        `route: ${activeRouteConnectionId}`,
        `port: ${activeCandidate.state.portId}`,
        `g: ${activeCandidate.g.toFixed(2)}`,
        `h: ${activeCandidate.h.toFixed(2)}`,
        `f: ${activeCandidate.f.toFixed(2)}`,
      ].join("\n"),
    })
  }

  private finalizeSolvedTrace(
    traceIndex: number,
    traceState: BusTraceState,
    traceCost: number,
  ) {
    this.busState.solvedTraceStates[traceIndex] = traceState
    this.busState.solvedTraceCosts[traceIndex] = traceCost
    this.busState.activeTraceSearch = undefined
    this.commitSolvedTrace(traceState)

    const pathPortIds = this.getTracePathPortIds(traceState)
    for (const portId of pathPortIds) {
      this.busState.reservedPortIds.add(portId)
    }

    if (traceIndex === this.centerTraceIndex) {
      this.busState.centerlinePortIds = pathPortIds
      if (this.outerTraceIndices.length === 0) {
        this.busState.phase = "done"
        this.solved = true
        return
      }

      this.busState.phase = "outer"
      return
    }

    this.busState.currentOuterTraceCursor += 1
    if (
      this.busState.currentOuterTraceCursor >= this.outerTraceIndices.length
    ) {
      this.busState.phase = "done"
      this.solved = true
    }
  }

  private getTraceStateKey(traceState: BusTraceState) {
    return [
      traceState.routeId,
      traceState.portId,
      traceState.nextRegionId ?? -1,
      traceState.atGoal ? 1 : 0,
    ].join(":")
  }

  private getTraceConnectionId(traceIndex: number) {
    return (
      this.busTraceOrder.traces[traceIndex]?.connectionId ??
      `trace-${traceIndex}`
    )
  }

  private getSolvedBusCost() {
    let totalCost = 0
    for (const traceCost of this.busState.solvedTraceCosts) {
      totalCost += traceCost
    }
    return totalCost
  }

  private updateBusStats(currentCandidate?: TraceSearchCandidate) {
    const activeTraceSearch = this.busState.activeTraceSearch
    this.stats = {
      ...this.stats,
      routeCount: this.problem.routeCount,
      busCenterConnectionId:
        this.busTraceOrder.traces[this.centerTraceIndex]?.connectionId,
      busPhase: this.busState.phase,
      currentTraceIndex: activeTraceSearch?.traceIndex,
      currentTraceConnectionId:
        activeTraceSearch !== undefined
          ? this.getTraceConnectionId(activeTraceSearch.traceIndex)
          : undefined,
      busCandidateCount: activeTraceSearch?.bestCostByTraceState.size ?? 0,
      openCandidateCount: activeTraceSearch?.candidateQueue.length ?? 0,
      solvedTraceCount: this.busState.solvedTraceStates.filter(Boolean).length,
      currentBusCost: this.getSolvedBusCost(),
      currentTraceCost: currentCandidate?.g,
      currentTraceHeuristic: currentCandidate?.h,
    }
  }
}
