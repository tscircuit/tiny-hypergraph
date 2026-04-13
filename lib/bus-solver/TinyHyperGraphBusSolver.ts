import { MinHeap } from "../MinHeap"
import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { NetId, PortId, RegionId, RouteId } from "../types"
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

interface BusTraceMove {
  nextState: BusTraceState
  segmentLength: number
  alignmentCost: number
  selectionScore: number
}

interface BusCandidate {
  traceStates: BusTraceState[]
  g: number
  h: number
  f: number
}

const BUS_CANDIDATE_EPSILON = 1e-9

export class TinyHyperGraphBusSolver extends TinyHyperGraphSolver {
  BUS_TRACE_SEPARATION = 0.1
  BUS_ALIGNMENT_COST_FACTOR = 0.2
  BUS_HEURISTIC_WEIGHT = 1.5

  readonly busTraceOrder: BusTraceOrder

  private readonly centerTraceIndex: number
  private readonly outerTraceIndices: number[]

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

    this.updateBusStats()
  }

  override _setup() {
    this.resetCommittedSolution()
    void this.problemSetup
    this.updateBusStats()
  }

  override _step() {
    const solvedCandidate = this.solveBusCandidate()

    if (!solvedCandidate) {
      this.failed = true
      this.error = "No bus path candidate found"
      this.updateBusStats()
      return
    }

    this.commitSolvedCandidate(solvedCandidate)
    this.solved = true
    this.updateBusStats(solvedCandidate)
  }

  private solveBusCandidate(): BusCandidate | undefined {
    const centerRouteId = this.busTraceOrder.centerTraceRouteId
    const centerTraceState = this.solveTraceRoute(centerRouteId)

    if (!centerTraceState) {
      return undefined
    }

    const centerlinePortIds = this.getTracePathPortIds(centerTraceState)
    const reservedPortIds = new Set(centerlinePortIds)
    const traceStates = Array.from(
      { length: this.problem.routeCount },
      () => undefined as BusTraceState | undefined,
    )

    traceStates[this.centerTraceIndex] = centerTraceState

    for (const traceIndex of this.outerTraceIndices) {
      const trace = this.busTraceOrder.traces[traceIndex]!
      const traceState = this.solveTraceRoute(trace.routeId, {
        traceIndex,
        centerlinePortIds,
        reservedPortIds,
      })

      if (!traceState) {
        return undefined
      }

      traceStates[traceIndex] = traceState

      for (const portId of this.getTracePathPortIds(traceState)) {
        reservedPortIds.add(portId)
      }
    }

    if (traceStates.some((traceState) => !traceState)) {
      return undefined
    }

    const finalTraceStates = traceStates as BusTraceState[]
    const g = this.computeSolvedCandidateCost(
      finalTraceStates,
      centerlinePortIds,
    )

    return {
      traceStates: finalTraceStates,
      g,
      h: 0,
      f: g,
    }
  }

  private solveTraceRoute(
    routeId: RouteId,
    options?: {
      traceIndex: number
      centerlinePortIds: readonly PortId[]
      reservedPortIds: ReadonlySet<PortId>
    },
  ): BusTraceState | undefined {
    interface TraceSearchCandidate {
      state: BusTraceState
      g: number
      h: number
      f: number
    }

    const compareTraceCandidates = (
      left: TraceSearchCandidate,
      right: TraceSearchCandidate,
    ) => left.f - right.f || left.h - right.h || left.g - right.g

    const startState = this.createStartingTraceState(routeId)
    if (startState.atGoal) {
      return startState
    }

    const traceQueue = new MinHeap<TraceSearchCandidate>(
      [],
      compareTraceCandidates,
    )
    const bestCostByTraceState = new Map<string, number>()
    const startH = this.computeTraceHeuristic(startState)

    traceQueue.queue({
      state: startState,
      g: 0,
      h: startH,
      f:
        0 +
        startH * (options?.centerlinePortIds ? this.BUS_HEURISTIC_WEIGHT : 1),
    })
    bestCostByTraceState.set(this.getTraceStateKey(startState), 0)

    while (traceQueue.length > 0) {
      const currentCandidate = traceQueue.dequeue()

      if (!currentCandidate) {
        break
      }

      if (currentCandidate.state.atGoal) {
        return currentCandidate.state
      }

      const currentBestCost = bestCostByTraceState.get(
        this.getTraceStateKey(currentCandidate.state),
      )
      if (
        currentBestCost !== undefined &&
        currentCandidate.g > currentBestCost + BUS_CANDIDATE_EPSILON
      ) {
        continue
      }

      for (const move of this.getAvailableTraceMoves(currentCandidate.state)) {
        if (move.nextState === currentCandidate.state) {
          continue
        }

        if (options?.reservedPortIds.has(move.nextState.portId)) {
          continue
        }

        let nextG =
          currentCandidate.g + move.segmentLength * this.DISTANCE_TO_COST
        let nextH = this.computeTraceHeuristic(move.nextState)
        let nextF = nextG + nextH

        if (options) {
          const traceMetadata = this.busTraceOrder.traces[options.traceIndex]!
          const centerPortId =
            options.centerlinePortIds[options.centerlinePortIds.length - 1]

          if (
            !this.isPortOnExpectedSideOfCenterline(
              traceMetadata.signedIndexFromCenter,
              centerPortId!,
              move.nextState.portId,
            )
          ) {
            continue
          }

          if (
            this.doesTraceMoveIntersectCenterline(
              currentCandidate.state.portId,
              move.nextState.portId,
              options.centerlinePortIds,
            )
          ) {
            continue
          }

          const alignmentCost = this.computeTraceAlignmentCost(
            options.traceIndex,
            options.centerlinePortIds,
            move.nextState.portId,
          )

          nextG += alignmentCost * this.BUS_ALIGNMENT_COST_FACTOR
          nextF = nextG + nextH * this.BUS_HEURISTIC_WEIGHT
        }

        const nextStateKey = this.getTraceStateKey(move.nextState)
        const existingBestCost = bestCostByTraceState.get(nextStateKey)

        if (
          existingBestCost !== undefined &&
          nextG >= existingBestCost - BUS_CANDIDATE_EPSILON
        ) {
          continue
        }

        bestCostByTraceState.set(nextStateKey, nextG)
        traceQueue.queue({
          state: move.nextState,
          g: nextG,
          h: nextH,
          f: nextF,
        })
      }
    }

    return undefined
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

  private getCenterTraceMoves(traceState: BusTraceState): BusTraceMove[] {
    if (traceState.atGoal) {
      return [
        {
          nextState: traceState,
          segmentLength: 0,
          alignmentCost: 0,
          selectionScore: 0,
        },
      ]
    }

    return this.getAvailableTraceMoves(traceState)
      .map((move) => ({
        ...move,
        alignmentCost: 0,
        selectionScore:
          move.segmentLength * this.DISTANCE_TO_COST +
          this.computeTraceHeuristic(move.nextState) *
            this.BUS_HEURISTIC_WEIGHT,
      }))
      .sort(
        (left, right) =>
          left.selectionScore - right.selectionScore ||
          left.nextState.portId - right.nextState.portId,
      )
      .slice(0, 3)
  }

  private getAvailableTraceMoves(traceState: BusTraceState): BusTraceMove[] {
    if (traceState.atGoal || traceState.nextRegionId === undefined) {
      return []
    }

    const routeId = traceState.routeId
    const goalPortId = this.problem.routeEndPort[routeId]!
    const currentNetId = this.problem.routeNet[routeId]!
    const currentRegionId = traceState.nextRegionId
    const moves: BusTraceMove[] = []

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
          alignmentCost: 0,
          selectionScore: segmentLength * this.DISTANCE_TO_COST,
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
        alignmentCost: 0,
        selectionScore: segmentLength * this.DISTANCE_TO_COST,
      })
    }

    moves.push({
      nextState: traceState,
      segmentLength: 0,
      alignmentCost: 0,
      selectionScore:
        this.computeTraceHeuristic(traceState) * this.BUS_HEURISTIC_WEIGHT,
    })

    return moves
  }

  private selectBestTraceMove(
    traceIndex: number,
    traceState: BusTraceState,
    centerPortId: PortId,
    centerlinePortIds: readonly PortId[],
    usedPortIds: Set<PortId>,
  ): BusTraceMove | undefined {
    const traceMetadata = this.busTraceOrder.traces[traceIndex]!
    const baseMoves = this.getAvailableTraceMoves(traceState)
    let bestMove: BusTraceMove | undefined

    for (const move of baseMoves) {
      if (usedPortIds.has(move.nextState.portId)) {
        continue
      }

      if (
        !this.isPortOnExpectedSideOfCenterline(
          traceMetadata.signedIndexFromCenter,
          centerPortId,
          move.nextState.portId,
        )
      ) {
        continue
      }

      if (
        this.doesTraceMoveIntersectCenterline(
          traceState.portId,
          move.nextState.portId,
          centerlinePortIds,
        )
      ) {
        continue
      }

      const alignmentCost = this.computeTraceAlignmentCost(
        traceIndex,
        centerlinePortIds,
        move.nextState.portId,
      )
      const selectionScore =
        move.segmentLength * this.DISTANCE_TO_COST +
        alignmentCost * this.BUS_ALIGNMENT_COST_FACTOR +
        this.computeTraceHeuristic(move.nextState) * this.BUS_HEURISTIC_WEIGHT

      if (
        !bestMove ||
        selectionScore < bestMove.selectionScore - BUS_CANDIDATE_EPSILON
      ) {
        bestMove = {
          nextState: move.nextState,
          segmentLength: move.segmentLength,
          alignmentCost,
          selectionScore,
        }
      }
    }

    return bestMove
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

  private computeBusHeuristic(traceStates: readonly BusTraceState[]) {
    let heuristic = 0

    for (const traceState of traceStates) {
      heuristic += this.computeTraceHeuristic(traceState)
    }

    return heuristic
  }

  private areAllTraceStatesAtGoal(traceStates: readonly BusTraceState[]) {
    return traceStates.every((traceState) => traceState.atGoal)
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

  private commitSolvedCandidate(candidate: BusCandidate) {
    this.resetCommittedSolution()

    for (const traceState of candidate.traceStates) {
      const routeNetId = this.problem.routeNet[traceState.routeId]!

      for (const segment of this.getTraceSegments(traceState)) {
        this.state.regionSegments[segment.regionId]!.push([
          traceState.routeId,
          segment.fromPortId,
          segment.toPortId,
        ])
        this.state.portAssignment[segment.fromPortId] = routeNetId
        this.state.portAssignment[segment.toPortId] = routeNetId
      }
    }
  }

  private getBusStateKey(traceStates: readonly BusTraceState[]) {
    return traceStates
      .map((traceState) =>
        [
          traceState.routeId,
          traceState.portId,
          traceState.nextRegionId ?? -1,
          traceState.atGoal ? 1 : 0,
        ].join(":"),
      )
      .join("|")
  }

  private getTraceStateKey(traceState: BusTraceState) {
    return [
      traceState.routeId,
      traceState.portId,
      traceState.nextRegionId ?? -1,
      traceState.atGoal ? 1 : 0,
    ].join(":")
  }

  private computeSolvedCandidateCost(
    traceStates: readonly BusTraceState[],
    centerlinePortIds: readonly PortId[],
  ) {
    let totalCost = 0

    for (const traceState of traceStates) {
      const traceIndex = this.busTraceOrder.traces.findIndex(
        (trace) => trace.routeId === traceState.routeId,
      )

      for (const segment of this.getTraceSegments(traceState)) {
        totalCost +=
          getPortDistance(this.topology, segment.fromPortId, segment.toPortId) *
          this.DISTANCE_TO_COST
      }

      if (traceIndex === this.centerTraceIndex || traceIndex === -1) {
        continue
      }

      for (const portId of this.getTracePathPortIds(traceState).slice(1)) {
        totalCost +=
          this.computeTraceAlignmentCost(
            traceIndex,
            centerlinePortIds,
            portId,
          ) * this.BUS_ALIGNMENT_COST_FACTOR
      }
    }

    return totalCost
  }

  private updateBusStats(candidate?: BusCandidate) {
    this.stats = {
      ...this.stats,
      routeCount: this.problem.routeCount,
      busCenterConnectionId:
        this.busTraceOrder.traces[this.centerTraceIndex]?.connectionId,
      busCandidateCount: candidate ? 1 : 0,
      openCandidateCount: 0,
      solvedRouteCount: candidate
        ? candidate.traceStates.filter((traceState) => traceState.atGoal).length
        : 0,
      currentBusCost: candidate?.g,
      currentBusHeuristic: candidate?.h,
    }
  }
}
