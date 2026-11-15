import type {
  TinyHyperGraphTopology,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
} from "../core"
import { NativePortfolioSolver } from "./NativePortfolioSolver"
export class NativeDistancePortfolioSolver extends NativePortfolioSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.ADD_SEGMENT_DISTANCE_TO_G = true
  }
}
