import {
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import { CachedPortfolioSolver } from "./CachedPortfolioSolver"
import type {
  SharedRouteDistances,
  SharedRouteHeuristics,
} from "./shared-distances"
import { DenseIndexedCandidateHeap } from "./DenseIndexedCandidateHeap"

export class CachedDistancePortfolioSolver extends CachedPortfolioSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: TinyHyperGraphSolverOptions,
    distances?: SharedRouteDistances,
    heuristics?: SharedRouteHeuristics,
  ) {
    super(topology, problem, options, distances, heuristics)
    this.ADD_SEGMENT_DISTANCE_TO_G = true
  }
  override getSolverName() {
    return "DistanceAwareTinyHyperGraphSolver"
  }
  override _setup() {
    if (
      !this.topology.regionIncidentPorts.every((ports, r) =>
        ports.every((p) => this.topology.incidentPortRegion[p].includes(r)),
      )
    ) {
      DistanceAwareTinyHyperGraphSolver.prototype._setup.call(this)
      return
    }
    super._setup()
    this.state.candidateQueue = new DenseIndexedCandidateHeap(
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
  override onPathFound(candidate: Candidate) {
    DistanceAwareTinyHyperGraphSolver.prototype.onPathFound.call(
      this,
      candidate,
    )
  }
}
