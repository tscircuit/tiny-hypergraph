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
  }

  override _setup(): void {
    super._setup()
    this.state.candidateQueue = new IndexedCandidateHeap(
      this.topology.regionCount,
    ) as unknown as TinyHyperGraphWorkingState["candidateQueue"]
  }

  protected override computeCandidateRegionRiskCost(
    currentCandidate: Candidate,
    neighborPortId: number,
    regionRiskIncrement: number,
    routeLengthIncrement: number,
  ): number {
    return (
      super.computeCandidateRegionRiskCost(
        currentCandidate,
        neighborPortId,
        regionRiskIncrement,
        routeLengthIncrement,
      ) + routeLengthIncrement
    )
  }

}
