import {
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import { CachedPortfolioSolver } from "./CachedPortfolioSolver"

export class CachedDistancePortfolioSolver extends CachedPortfolioSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.ADD_SEGMENT_DISTANCE_TO_G = true
  }
  override getSolverName() {
    return "DistanceAwareTinyHyperGraphSolver"
  }
  override _setup() {
    DistanceAwareTinyHyperGraphSolver.prototype._setup.call(this)
  }
  override onPathFound(candidate: Candidate) {
    DistanceAwareTinyHyperGraphSolver.prototype.onPathFound.call(
      this,
      candidate,
    )
  }
}
