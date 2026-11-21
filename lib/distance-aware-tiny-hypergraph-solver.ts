import {
  type Candidate,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { IndexedCandidateHeap } from "./indexed-candidate-heap"
import { PortPenaltyLowerBound } from "./PortPenaltyLowerBound"
import type { PortId, RouteId } from "./types"

/**
 * Adds geometric segment distance to the normal dynamic routing cost.
 *
 * Every segment, including the final segment into the goal, uses the same
 * g-cost calculation. The hop-keyed candidate frontier prevents a dominated
 * queued hop from being expanded later.
 */
export class DistanceAwareTinyHyperGraphSolver extends TinyHyperGraphSolver {
  private readonly portPenaltyLowerBound?: PortPenaltyLowerBound

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.ADD_SEGMENT_DISTANCE_TO_G = true
    if (problem.portPenalty?.some((penalty) => penalty > 0)) {
      this.portPenaltyLowerBound = new PortPenaltyLowerBound({
        topology,
        problem,
        endpointReservations: this.problemSetup.portEndpointReservationNetId,
      })
    }
  }

  protected override getRouteHeuristic(
    routeId: RouteId,
    portId: PortId,
  ): number {
    const distance = super.getRouteHeuristic(routeId, portId)
    if (!this.portPenaltyLowerBound) return distance
    return (
      distance +
      this.portPenaltyLowerBound.getLowerBound({
        netId: this.problem.routeNet[routeId],
        endPortId: this.getRouteEndPortId(routeId),
        portId,
      })
    )
  }

  override _setup(): void {
    super._setup()
    this.state.candidateQueue = new IndexedCandidateHeap(
      this.topology.regionCount,
      {
        hopCapacity: this.candidateHopCapacity,
        hopSlotStride: this.candidateHopSlotStride,
        firstRegionByPortId: this.candidateFirstRegionByPortId,
        secondRegionByPortId: this.candidateSecondRegionByPortId,
        incidentPortRegion: this.topology.incidentPortRegion,
      },
    )
  }

  override onPathFound(finalCandidate: Candidate): void {
    const goalPortId = this.state.goalPortId
    if (finalCandidate.portId === goalPortId) {
      super.onPathFound(finalCandidate)
      return
    }

    const g = this.computeG(finalCandidate, goalPortId)
    if (!Number.isFinite(g)) return

    const goalHopId = this.getHopId(goalPortId, finalCandidate.nextRegionId)
    if (g >= this.getCandidateBestCost(goalHopId)) return

    this.setCandidateBestCost(goalHopId, g)
    this.state.candidateQueue.queue({
      hopId: goalHopId,
      prevRegionId: finalCandidate.nextRegionId,
      nextRegionId: finalCandidate.nextRegionId,
      portId: goalPortId,
      g,
      h: 0,
      f: g,
      prevCandidate: finalCandidate,
    })
  }
}
