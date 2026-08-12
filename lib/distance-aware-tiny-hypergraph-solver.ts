import {
  type Candidate,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
  type TinyHyperGraphWorkingState,
} from "./core"
import { IndexedCandidateHeap } from "./indexed-candidate-heap"

/**
 * Adds geometric segment distance to the normal dynamic routing cost.
 *
 * Every segment, including the final segment into the goal, uses the same
 * g-cost calculation. The hop-keyed candidate frontier prevents a dominated
 * queued hop from being expanded later.
 */
export class DistanceAwareTinyHyperGraphSolver extends TinyHyperGraphSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.includeSegmentDistanceInG = true
  }

  override _setup(): void {
    super._setup()
    this.state.candidateQueue = new IndexedCandidateHeap(
      this.topology.regionCount,
    ) as unknown as TinyHyperGraphWorkingState["candidateQueue"]
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
