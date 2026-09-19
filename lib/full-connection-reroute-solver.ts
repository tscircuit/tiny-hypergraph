import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "./compat/loadSerializedHyperGraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  TinyHyperGraphSolver,
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolution,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { TinyHyperGraphSectionSolver } from "./section-solver"

export interface FullConnectionRerouteOptions {
  maxHotRegions?: number
  maxAttempts?: number
  maxIterationsPerAttempt?: number
  /** Total search steps across all candidates; returns the complete incumbent on exhaustion. */
  maxTotalIterations?: number
}

// Keep every other connection fixed, and never reseed/rip the graph on failure.
class AvoidRegionRouteSolver extends TinyHyperGraphSolver {
  blockedRegionId = -1

  /** Seed from a validated incumbent without revalidating every fixed connection. */
  seedFromIncumbent(incumbent: TinyHyperGraphSolver, routeId: number): void {
    const { state } = this
    state.unroutedRoutes = [routeId]
    // Appending a segment replaces its cache (including typed arrays), so unchanged
    // caches can be shared. Segment lists must be copied because onPathFound pushes.
    state.regionIntersectionCaches =
      incumbent.state.regionIntersectionCaches.slice()
    state.regionSegments = incumbent.state.regionSegments.map(
      (segments, regionId) => {
        const kept = segments.filter(([id]) => id !== routeId)
        if (kept.length !== segments.length) {
          state.regionIntersectionCaches[regionId] =
            createEmptyRegionIntersectionCache()
          for (const [id, fromPortId, toPortId] of kept) {
            state.currentRouteNetId = this.problem.routeNet[id]
            this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
          }
        }
        // Rebuild occupancy from retained segments: shared-net ports must stay occupied.
        for (const [id, fromPortId, toPortId] of kept) {
          state.portAssignment[fromPortId] = this.problem.routeNet[id]
          state.portAssignment[toPortId] = this.problem.routeNet[id]
          this.routeSuccessCountByRouteId[id] = 1
        }
        return kept
      },
    )
    state.currentRouteNetId = undefined
  }

  summarizeInReplayOrder(): ReturnType<typeof summarize> {
    // Replay inserts segments in route-id order. The intersection counter treats
    // coincident angles differently depending on insertion order, so appending a
    // rerouted connection last is not a reliable score for screening candidates.
    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      const segments = this.state.regionSegments[regionId]!
      if (
        !segments.some(
          ([id], index) => index > 0 && id < segments[index - 1]![0],
        )
      )
        continue
      this.state.regionIntersectionCaches[regionId] =
        createEmptyRegionIntersectionCache()
      for (const [id, from, to] of segments
        .slice()
        .sort((a, b) => a[0] - b[0])) {
        this.state.currentRouteNetId = this.problem.routeNet[id]
        this.appendSegmentToRegionCache(regionId, from, to)
      }
    }
    this.state.currentRouteNetId = undefined
    return summarize(this)
  }

  override isRegionReservedForDifferentNet(regionId: number): boolean {
    return (
      regionId === this.blockedRegionId ||
      super.isRegionReservedForDifferentNet(regionId)
    )
  }

  override getStartingNextRegionId(
    routeId: number,
    startingPortId: number,
  ): number | undefined {
    const preferredRegion = super.getStartingNextRegionId(
      routeId,
      startingPortId,
    )
    if (
      preferredRegion !== undefined &&
      !this.isRegionReservedForDifferentNet(preferredRegion)
    ) {
      return preferredRegion
    }
    return this.topology.incidentPortRegion[startingPortId]?.find(
      (regionId) => !this.isRegionReservedForDifferentNet(regionId),
    )
  }

  override onAllRoutesRouted(): void {
    this.solved = true
  }

  override onOutOfCandidates(): void {
    this.failed = true
    this.error = "No route avoiding the selected high-cost region"
  }
}

const summarize = (solver: TinyHyperGraphSolver) => {
  let max = 0
  let total = 0
  for (const cache of solver.state.regionIntersectionCaches) {
    max = Math.max(max, cache.existingRegionCost)
    total += cache.existingRegionCost
  }
  return { max, total }
}

const improvesScore = (
  after: ReturnType<typeof summarize>,
  before: ReturnType<typeof summarize>,
) =>
  after.max < before.max - 1e-9 ||
  (Math.abs(after.max - before.max) <= 1e-9 &&
    after.max <= before.max &&
    after.total < before.total - 1e-9)

/** Try full connections individually; only retain strict whole-graph improvements. */
export class FullConnectionRerouteSolver extends BaseSolver {
  bestSolver: TinyHyperGraphSolver
  private acceptedOutput: SerializedHyperGraph
  private attempts: Array<{ regionId: number; routeId: number }>
  private candidate?: AvoidRegionRouteSolver
  private attemptIndex = 0
  private accepted = 0
  private replayCount = 0
  private initialScore: ReturnType<typeof summarize>
  private bestScore: ReturnType<typeof summarize>

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    solution: TinyHyperGraphSolution,
    public solverOptions: TinyHyperGraphSolverOptions = {},
    public options: FullConnectionRerouteOptions = {},
    serializedInput?: SerializedHyperGraph,
    private loadHyperGraph: typeof loadSerializedHyperGraph = loadSerializedHyperGraph,
  ) {
    super()
    this.bestSolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      solution,
      solverOptions,
    ).baselineSolver
    this.acceptedOutput = serializedInput ?? this.bestSolver.getOutput()
    this.initialScore = summarize(this.bestSolver)
    this.bestScore = this.initialScore
    this.attempts = this.bestSolver.state.regionIntersectionCaches
      .map((cache, regionId) => ({ regionId, cost: cache.existingRegionCost }))
      .filter(({ cost }) => cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, options.maxHotRegions ?? 8)
      .flatMap(({ regionId }) =>
        [
          ...new Set(
            this.bestSolver.state.regionSegments[regionId]!.map(
              ([routeId]) => routeId,
            ),
          ),
        ]
          // Boundary endpoints can escape through their other incident region.
          // Only skip endpoints that have no incident region outside the blocked one.
          .filter(
            (routeId) =>
              topology.incidentPortRegion[
                problem.routeStartPort[routeId]!
              ]!.some((incidentRegionId) => incidentRegionId !== regionId) &&
              topology.incidentPortRegion[problem.routeEndPort[routeId]!]!.some(
                (incidentRegionId) => incidentRegionId !== regionId,
              ),
          )
          .map((routeId) => ({ regionId, routeId })),
      )
      .slice(0, options.maxAttempts ?? 64)
    this.MAX_ITERATIONS = Math.min(
      options.maxTotalIterations ?? Number.POSITIVE_INFINITY,
      (options.maxIterationsPerAttempt ?? 20_000) * this.attempts.length +
        this.attempts.length +
        1,
    )
  }

  override _step(): void {
    if (!this.candidate) {
      const attempt = this.attempts[this.attemptIndex]
      if (!attempt) {
        this.finish()
        return
      }
      this.candidate = new AvoidRegionRouteSolver(
        this.topology,
        {
          ...this.problem,
          portSectionMask: new Int8Array(this.topology.portCount).fill(1),
          initialAssignments: undefined,
        },
        {
          ...this.solverOptions,
          USE_LAZY_ROUTE_HEURISTIC: true,
          MAX_ITERATIONS: this.options.maxIterationsPerAttempt ?? 20_000,
          STATIC_REACHABILITY_PRECHECK: false,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
          GREEDY_FINAL_ROUTE_ITERS: 0,
        },
      )
      this.candidate.seedFromIncumbent(this.bestSolver, attempt.routeId)
      this.candidate.blockedRegionId = attempt.regionId
    }
    this.candidate.step()
    if (!this.candidate.solved && !this.candidate.failed) return
    const score =
      this.candidate.solved && !this.candidate.failed
        ? this.candidate.summarizeInReplayOrder()
        : undefined
    // Most candidates cannot improve the incumbent. Only promising candidates
    // pay for serialization and replay; replay remains the acceptance authority.
    if (
      score &&
      (score.max < this.bestScore.max - 1e-9 ||
        (score.max <= this.bestScore.max + 1e-9 &&
          score.total <= this.bestScore.total + 1e-9))
    ) {
      this.replayCount += 1
      const before = this.bestScore
      const candidateOutput = this.candidate.getOutput()
      const replay = this.loadHyperGraph(candidateOutput)
      const replaySolver = new TinyHyperGraphSectionSolver(
        replay.topology,
        replay.problem,
        replay.solution,
        this.solverOptions,
      ).baselineSolver
      const after = summarize(replaySolver)
      if (improvesScore(after, before)) {
        this.bestSolver = replaySolver
        this.bestScore = after
        this.acceptedOutput = candidateOutput
        this.accepted += 1
      }
    }
    this.candidate = undefined
    this.attemptIndex += 1
  }

  private finish(): void {
    const score = this.bestScore
    this.stats = {
      ...this.stats,
      rerouteAttempts: this.attemptIndex,
      acceptedReroutes: this.accepted,
      rerouteReplayCount: this.replayCount,
      initialMaxRegionCost: this.initialScore.max,
      finalMaxRegionCost: score.max,
      initialTotalRegionCost: this.initialScore.total,
      finalTotalRegionCost: score.total,
    }
    this.candidate = undefined
    this.solved = true
    this.failed = false
    this.error = null
  }

  override tryFinalAcceptance(): void {
    // The incumbent is always complete, including when the search budget expires.
    this.finish()
  }

  getSolvedSolver(): TinyHyperGraphSolver {
    return this.bestSolver
  }

  override getOutput() {
    return this.acceptedOutput
  }

  override visualize() {
    return this.bestSolver.visualize()
  }
}
