import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { CachedRouteSearchSolver } from "./CachedRouteSearchSolver"
import type {
  SharedRouteDistances,
  SharedRouteHeuristics,
} from "./shared-distances"

/** Use the cached expansion engine for a complete serial candidate. All route
 * insertion, rerips, best-state acceptance and greedy tails retain core behavior. */
export class CachedPortfolioSolver extends CachedRouteSearchSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions,
    distances?: SharedRouteDistances,
    heuristics?: SharedRouteHeuristics,
  ) {
    super(topology, problem, options, distances, heuristics)
    this.trackReads = false
  }
  override getSolverName() {
    return "TinyHyperGraphSolver"
  }
  override appendSegmentToRegionCache(
    region: number,
    from: number,
    to: number,
  ) {
    super.appendSegmentToRegionCache(region, from, to)
    this.invalidateScoreCache(region)
  }
  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.clearScoreCaches()
  }
  override onPathFound(candidate: Candidate) {
    TinyHyperGraphSolver.prototype.onPathFound.call(this, candidate)
  }
  override onOutOfCandidates() {
    TinyHyperGraphSolver.prototype.onOutOfCandidates.call(this)
  }
}
