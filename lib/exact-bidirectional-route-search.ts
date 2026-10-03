import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "./core"
import { MinHeap } from "./MinHeap"
import type { PortId, RegionId } from "./types"

type BidirectionalSearchCandidate = Candidate & {
  reducedCost: number
  nextCandidateTowardGoal?: BidirectionalSearchCandidate
}

type SearchFrontier = {
  queue: MinHeap<BidirectionalSearchCandidate>
  bestCostByHopId: Map<number, number>
  settledByHopId: Map<number, BidirectionalSearchCandidate>
}

export interface ExactBidirectionalRouteSearchSolver {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  state: TinyHyperGraphWorkingState
  DISTANCE_TO_COST: number
  computeG(
    currentCandidate: Candidate,
    neighborPortId: PortId,
    maximumCost?: number,
    knownSegmentDistance?: number,
  ): number
  getRoutingDistanceCostScale(): number
  isPortReservedForDifferentNet(portId: PortId): boolean
  isRegionReservedForDifferentNet(regionId: RegionId): boolean
}

type ExactBidirectionalRouteSearchParams = {
  solver: ExactBidirectionalRouteSearchSolver
  startPortId: PortId
  endPortId: PortId
  startRegionId: RegionId
}

export type ExactBidirectionalRouteSearchStep =
  | { status: "searching" }
  | { status: "found"; finalCandidate: Candidate }
  | { status: "exhausted" }

const COST_EPSILON = 1e-9

/**
 * Finds an exact minimum-cost path over directed port-region hops.
 *
 * Euclidean distance is applied as a balanced potential, so both frontiers
 * retain non-negative reduced edge costs and Dijkstra's stopping condition
 * remains exact. The original edge costs are still supplied exclusively by
 * the solver's computeG implementation.
 */
export class ExactBidirectionalRouteSearch {
  private readonly solver: ExactBidirectionalRouteSearchSolver
  private readonly startPortId: PortId
  private readonly endPortId: PortId
  private readonly startRegionId: RegionId
  private readonly forward: SearchFrontier
  private readonly reverse: SearchFrontier
  private expandForwardOnTie = true
  private bestPathCost = Number.POSITIVE_INFINITY
  private bestReducedPathCost = Number.POSITIVE_INFINITY
  private bestForwardCandidate?: BidirectionalSearchCandidate
  private bestReverseCandidate?: BidirectionalSearchCandidate
  forwardExpansionCount = 0
  reverseExpansionCount = 0

  constructor(params: ExactBidirectionalRouteSearchParams) {
    this.solver = params.solver
    this.startPortId = params.startPortId
    this.endPortId = params.endPortId
    this.startRegionId = params.startRegionId
    this.forward = this.createFrontier()
    this.reverse = this.createFrontier()

    this.queueCandidate(this.forward, {
      portId: this.startPortId,
      nextRegionId: this.startRegionId,
      g: 0,
      h: 0,
      f: 0,
      reducedCost: 0,
    })

    if (this.isPortAvailable(this.endPortId, this.endPortId)) {
      for (const endRegionId of this.solver.topology.incidentPortRegion[
        this.endPortId
      ] ?? []) {
        if (this.solver.isRegionReservedForDifferentNet(endRegionId)) continue
        this.queueCandidate(this.reverse, {
          portId: this.endPortId,
          nextRegionId: endRegionId,
          g: 0,
          h: 0,
          f: 0,
          reducedCost: 0,
        })
      }
    }
  }

  step(): ExactBidirectionalRouteSearchStep {
    const forwardCandidate = this.peekFreshCandidate(this.forward)
    const reverseCandidate = this.peekFreshCandidate(this.reverse)

    if (!forwardCandidate || !reverseCandidate) {
      return this.bestForwardCandidate && this.bestReverseCandidate
        ? { status: "found", finalCandidate: this.buildFinalCandidate() }
        : { status: "exhausted" }
    }

    if (
      forwardCandidate.reducedCost + reverseCandidate.reducedCost >=
      this.bestReducedPathCost - COST_EPSILON
    ) {
      return { status: "found", finalCandidate: this.buildFinalCandidate() }
    }

    const expandForward =
      forwardCandidate.reducedCost < reverseCandidate.reducedCost ||
      (Math.abs(forwardCandidate.reducedCost - reverseCandidate.reducedCost) <=
        COST_EPSILON &&
        this.expandForwardOnTie)
    this.expandForwardOnTie = !this.expandForwardOnTie

    if (expandForward) {
      this.expandForward()
      this.forwardExpansionCount += 1
    } else {
      this.expandReverse()
      this.reverseExpansionCount += 1
    }

    return { status: "searching" }
  }

  private createFrontier(): SearchFrontier {
    return {
      queue: new MinHeap<BidirectionalSearchCandidate>(
        [],
        (left, right) => left.reducedCost - right.reducedCost,
      ),
      bestCostByHopId: new Map(),
      settledByHopId: new Map(),
    }
  }

  private getHopId(portId: PortId, nextRegionId: RegionId): number {
    return portId * this.solver.topology.regionCount + nextRegionId
  }

  private queueCandidate(
    frontier: SearchFrontier,
    candidate: BidirectionalSearchCandidate,
  ): void {
    const hopId = this.getHopId(candidate.portId, candidate.nextRegionId)
    const previousBestCost =
      frontier.bestCostByHopId.get(hopId) ?? Number.POSITIVE_INFINITY
    if (candidate.g >= previousBestCost - COST_EPSILON) return
    frontier.bestCostByHopId.set(hopId, candidate.g)
    frontier.queue.queue(candidate)
  }

  private peekFreshCandidate(
    frontier: SearchFrontier,
  ): BidirectionalSearchCandidate | undefined {
    while (frontier.queue.length > 0) {
      const candidate = frontier.queue.peek()!
      const hopId = this.getHopId(candidate.portId, candidate.nextRegionId)
      const bestCost =
        frontier.bestCostByHopId.get(hopId) ?? Number.POSITIVE_INFINITY
      if (
        candidate.g <= bestCost + COST_EPSILON &&
        !frontier.settledByHopId.has(hopId)
      ) {
        return candidate
      }
      frontier.queue.dequeue()
    }
    return undefined
  }

  private dequeueFreshCandidate(
    frontier: SearchFrontier,
  ): BidirectionalSearchCandidate | undefined {
    const candidate = this.peekFreshCandidate(frontier)
    if (!candidate) return undefined
    frontier.queue.dequeue()
    const hopId = this.getHopId(candidate.portId, candidate.nextRegionId)
    frontier.settledByHopId.set(hopId, candidate)
    return candidate
  }

  private getPotentialForPort(portId: PortId): number {
    const { topology } = this.solver
    const distanceCostScale = this.solver.getRoutingDistanceCostScale()
    const x = topology.portX[portId]!
    const y = topology.portY[portId]!
    const startDx = x - topology.portX[this.startPortId]!
    const startDy = y - topology.portY[this.startPortId]!
    const endDx = x - topology.portX[this.endPortId]!
    const endDy = y - topology.portY[this.endPortId]!
    const distanceFromStart = Math.sqrt(startDx * startDx + startDy * startDy)
    const distanceToEnd = Math.sqrt(endDx * endDx + endDy * endDy)
    return ((distanceToEnd - distanceFromStart) * distanceCostScale) / 2
  }

  private getOtherIncidentRegion(
    portId: PortId,
    regionId: RegionId,
  ): RegionId | undefined {
    const incidentRegionIds =
      this.solver.topology.incidentPortRegion[portId] ?? []
    return incidentRegionIds[0] === regionId
      ? incidentRegionIds[1]
      : incidentRegionIds[0]
  }

  private isPortAvailable(portId: PortId, endpointPortId: PortId): boolean {
    const { problem, state } = this.solver
    if (this.solver.isPortReservedForDifferentNet(portId)) return false
    const assignedNetId = state.portAssignment[portId]!
    if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {
      return false
    }
    return portId === endpointPortId || problem.portSectionMask[portId] !== 0
  }

  private getSegmentDistance(fromPortId: PortId, toPortId: PortId): number {
    const { topology } = this.solver
    const dx = topology.portX[fromPortId]! - topology.portX[toPortId]!
    const dy = topology.portY[fromPortId]! - topology.portY[toPortId]!
    return Math.sqrt(dx * dx + dy * dy)
  }

  private getForwardEdgeCost(params: {
    fromPortId: PortId
    toPortId: PortId
    regionId: RegionId
  }): number {
    const fromCandidate: Candidate = {
      portId: params.fromPortId,
      nextRegionId: params.regionId,
      g: 0,
      h: 0,
      f: 0,
    }
    return this.solver.computeG(
      fromCandidate,
      params.toPortId,
      Number.POSITIVE_INFINITY,
      this.getSegmentDistance(params.fromPortId, params.toPortId),
    )
  }

  private getReducedEdgeCost(params: {
    fromPortId: PortId
    toPortId: PortId
    edgeCost: number
  }): number {
    const reducedCost =
      params.edgeCost +
      this.getPotentialForPort(params.toPortId) -
      this.getPotentialForPort(params.fromPortId)
    if (reducedCost < -COST_EPSILON) {
      throw new Error(`Negative reduced edge cost: ${reducedCost}`)
    }
    return Math.max(0, reducedCost)
  }

  private considerJoin(
    forwardCandidate: BidirectionalSearchCandidate,
    reverseCandidate: BidirectionalSearchCandidate,
  ): void {
    const pathCost = forwardCandidate.g + reverseCandidate.g
    const reducedPathCost =
      forwardCandidate.reducedCost + reverseCandidate.reducedCost
    if (pathCost >= this.bestPathCost - COST_EPSILON) return
    this.bestPathCost = pathCost
    this.bestReducedPathCost = reducedPathCost
    this.bestForwardCandidate = forwardCandidate
    this.bestReverseCandidate = reverseCandidate
  }

  private considerSettledJoin(
    candidate: BidirectionalSearchCandidate,
    oppositeFrontier: SearchFrontier,
    expandingForward: boolean,
  ): void {
    const hopId = this.getHopId(candidate.portId, candidate.nextRegionId)
    const oppositeCandidate = oppositeFrontier.settledByHopId.get(hopId)
    if (!oppositeCandidate) return
    if (expandingForward) {
      this.considerJoin(candidate, oppositeCandidate)
    } else {
      this.considerJoin(oppositeCandidate, candidate)
    }
  }

  private expandForward(): void {
    const candidate = this.dequeueFreshCandidate(this.forward)
    if (!candidate) return
    this.considerSettledJoin(candidate, this.reverse, true)
    if (this.solver.isRegionReservedForDifferentNet(candidate.nextRegionId)) {
      return
    }

    for (const neighborPortId of this.solver.topology.regionIncidentPorts[
      candidate.nextRegionId
    ] ?? []) {
      if (neighborPortId === candidate.portId) continue
      if (!this.isPortAvailable(neighborPortId, this.endPortId)) continue

      const nextRegionId =
        neighborPortId === this.endPortId
          ? candidate.nextRegionId
          : this.getOtherIncidentRegion(neighborPortId, candidate.nextRegionId)
      if (
        nextRegionId === undefined ||
        (neighborPortId !== this.endPortId &&
          this.solver.isRegionReservedForDifferentNet(nextRegionId))
      ) {
        continue
      }

      const edgeCost = this.getForwardEdgeCost({
        fromPortId: candidate.portId,
        toPortId: neighborPortId,
        regionId: candidate.nextRegionId,
      })
      if (!Number.isFinite(edgeCost)) continue
      const successor: BidirectionalSearchCandidate = {
        portId: neighborPortId,
        prevRegionId: candidate.nextRegionId,
        nextRegionId,
        prevCandidate: candidate,
        g: candidate.g + edgeCost,
        h: 0,
        f: 0,
        reducedCost:
          candidate.reducedCost +
          this.getReducedEdgeCost({
            fromPortId: candidate.portId,
            toPortId: neighborPortId,
            edgeCost,
          }),
      }
      successor.f = successor.reducedCost
      this.queueCandidate(this.forward, successor)
      this.considerSettledJoin(successor, this.reverse, true)
    }
  }

  private expandReverse(): void {
    const candidate = this.dequeueFreshCandidate(this.reverse)
    if (!candidate) return
    this.considerSettledJoin(candidate, this.forward, false)
    const previousRegionId =
      candidate.portId === this.endPortId
        ? candidate.nextRegionId
        : this.getOtherIncidentRegion(candidate.portId, candidate.nextRegionId)
    if (
      previousRegionId === undefined ||
      this.solver.isRegionReservedForDifferentNet(previousRegionId)
    ) {
      return
    }

    for (const previousPortId of this.solver.topology.regionIncidentPorts[
      previousRegionId
    ] ?? []) {
      if (previousPortId === candidate.portId) continue
      if (!this.isPortAvailable(previousPortId, this.startPortId)) continue
      if (
        previousPortId === this.startPortId &&
        previousRegionId !== this.startRegionId
      ) {
        continue
      }

      const edgeCost = this.getForwardEdgeCost({
        fromPortId: previousPortId,
        toPortId: candidate.portId,
        regionId: previousRegionId,
      })
      if (!Number.isFinite(edgeCost)) continue
      const predecessor: BidirectionalSearchCandidate = {
        portId: previousPortId,
        nextRegionId: previousRegionId,
        g: candidate.g + edgeCost,
        h: 0,
        f: 0,
        reducedCost:
          candidate.reducedCost +
          this.getReducedEdgeCost({
            fromPortId: previousPortId,
            toPortId: candidate.portId,
            edgeCost,
          }),
        nextCandidateTowardGoal: candidate,
      }
      predecessor.f = predecessor.reducedCost
      this.queueCandidate(this.reverse, predecessor)
      this.considerSettledJoin(predecessor, this.forward, false)
    }
  }

  private buildFinalCandidate(): Candidate {
    const forwardCandidate = this.bestForwardCandidate
    const reverseCandidate = this.bestReverseCandidate
    if (!forwardCandidate || !reverseCandidate) {
      throw new Error("Bidirectional route search completed without a join")
    }

    let joinedCandidate: Candidate = forwardCandidate
    let previousReverseCandidate = reverseCandidate
    let reverseCursor = reverseCandidate.nextCandidateTowardGoal
    while (reverseCursor) {
      const isGoal = reverseCursor.portId === this.endPortId
      joinedCandidate = {
        portId: reverseCursor.portId,
        prevRegionId: previousReverseCandidate.nextRegionId,
        nextRegionId: isGoal
          ? previousReverseCandidate.nextRegionId
          : reverseCursor.nextRegionId,
        prevCandidate: joinedCandidate,
        g: isGoal ? this.bestPathCost : 0,
        h: 0,
        f: isGoal ? this.bestPathCost : 0,
      }
      previousReverseCandidate = reverseCursor
      reverseCursor = reverseCursor.nextCandidateTowardGoal
    }

    return joinedCandidate
  }
}
