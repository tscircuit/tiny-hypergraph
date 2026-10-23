import {
  SolverRuntime,
  type SolverRuntimeExecutor,
} from "@tscircuit/solver-utils"
import {
  getTinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphWorkingState,
} from "./core"
import { applyInitialAssignments } from "./initialAssignments"
import {
  SelectiveReripTinyHyperGraphSolver,
  type SelectiveReripTinyHyperGraphStats,
} from "./selective-rerip-tiny-hyper-graph-solver"
import { shuffle } from "./shuffle"

/** Global rerips retain preloaded routes unless a selective rerip moves them. */
export class StableSelectiveReripTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>

  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    if (!this.initialAssignmentRouteIds) {
      this.initialAssignmentRouteIds = new Set(
        (this.problem.initialAssignments ?? []).map(
          (assignment) => assignment.routeId,
        ),
      )
    }
    return this.initialAssignmentRouteIds
  }

  override resetRoutingStateForRerip(): void {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return
    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}

type LaneInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  laneIndex: number
}
type LaneResult = {
  laneIndex: number
  iterations: number
  diversified: boolean
} & (
  | {
      status: "failed"
      error: string
    }
  | {
      status: "solved"
      state: Omit<TinyHyperGraphWorkingState, "candidateQueue">
      attempts: Uint32Array
      successes: Uint32Array
      stats: Record<string, unknown>
      blockerStats: SelectiveReripTinyHyperGraphStats
      maxCost: number
      totalCost: number
      layerChanges: number
      segments: number
    }
)

class PortfolioLane extends StableSelectiveReripTinyHyperGraphSolver {
  diversified = false

  constructor(private readonly input: LaneInput) {
    super(input.topology, input.problem, input.options)
  }

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (
      this.iterations < this.MAX_ITERATIONS / 4 ||
      this.state.unroutedRoutes.length <= 2
    )
      return
    this.diversified = true
    if (this.input.laneIndex === 0) return
    const [first, ...remaining] = this.state.unroutedRoutes
    this.state.unroutedRoutes = [
      first!,
      ...shuffle(remaining, this.input.laneIndex + this.state.ripCount),
    ]
  }

  routingCounts(): readonly [Uint32Array, Uint32Array] {
    return [this.routeAttemptCountByRouteId, this.routeSuccessCountByRouteId]
  }

  result(): LaneResult {
    const common = {
      laneIndex: this.input.laneIndex,
      iterations: this.iterations,
      diversified: this.diversified,
    }
    if (!this.solved || this.failed) {
      if (!this.failed)
        throw new Error("Cannot capture an unfinished portfolio lane")
      return {
        ...common,
        status: "failed",
        error: this.error ?? "Portfolio lane exhausted its routing budget",
      }
    }
    const { candidateQueue: _queue, ...state } = this.state
    let maxCost = 0
    let totalCost = 0
    let layerChanges = 0
    let segments = 0
    for (const cache of state.regionIntersectionCaches) {
      maxCost = Math.max(maxCost, cache.existingRegionCost)
      totalCost += cache.existingRegionCost
      layerChanges += cache.existingEntryExitLayerChanges
      segments += cache.existingSegmentCount
    }
    if (!Number.isFinite(maxCost) || !Number.isFinite(totalCost))
      throw new Error("Portfolio candidate has non-finite region costs")
    return {
      ...common,
      status: "solved",
      state,
      attempts: this.routeAttemptCountByRouteId,
      successes: this.routeSuccessCountByRouteId,
      stats: this.stats,
      blockerStats: this.getSelectiveReripStats(),
      maxCost,
      totalCost,
      layerChanges,
      segments,
    }
  }
}

/** Evaluate a bounded candidate; routing exhaustion is an explicit result. */
export class TinyHyperGraphPortfolioLaneEvaluation {
  static readonly solverName = "tiny-hypergraph.port-point-portfolio-lane.v1"
  private readonly lane: PortfolioLane
  private output?: LaneResult

  constructor(input: LaneInput) {
    this.lane = new PortfolioLane(input)
  }

  solve(): void {
    this.lane.solve()
    this.output = this.lane.result()
  }

  getOutput(): LaneResult {
    if (!this.output) throw new Error("Portfolio lane evaluation is unfinished")
    return this.output
  }
}
SolverRuntime.registerSolver(TinyHyperGraphPortfolioLaneEvaluation)

const compareResults = (
  left: Extract<LaneResult, { status: "solved" }>,
  right: Extract<LaneResult, { status: "solved" }>,
): number => {
  if (Math.abs(left.maxCost - right.maxCost) > 1e-9)
    return left.maxCost - right.maxCost
  if (Math.abs(left.totalCost - right.totalCost) > 1e-9)
    return left.totalCost - right.totalCost
  return (
    left.layerChanges - right.layerChanges ||
    left.segments - right.segments ||
    left.laneIndex - right.laneIndex
  )
}

/** Four deterministic half-budget searches; workers affect execution, never selection. */
export class ParallelSelectiveReripTinyHyperGraphSolver extends StableSelectiveReripTinyHyperGraphSolver {
  private readonly laneBudget: number
  private lane?: PortfolioLane
  private readonly results: LaneResult[] = []
  private selectedBlockerStats?: SelectiveReripTinyHyperGraphStats
  private asyncRunning = false
  private canonicalQueue?: TinyHyperGraphWorkingState["candidateQueue"]

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.laneBudget = Math.max(1, Math.ceil(this.MAX_ITERATIONS / 2))
    // Each synchronous step advances at most two native expansions. Hard
    // boards use twice the original total work across four independent lanes.
    this.MAX_ITERATIONS = this.laneBudget * 2 + 1
  }

  private laneInput(laneIndex: number): LaneInput {
    return {
      topology: this.topology,
      problem: this.problem,
      options: {
        ...getTinyHyperGraphSolverOptions(this),
        MAX_ITERATIONS: this.laneBudget,
      },
      laneIndex,
    }
  }

  override _step(): void {
    this.canonicalQueue ??= this.state.candidateQueue
    for (let count = 0; count < 2 && !this.solved && !this.failed; count++) {
      if (!this.lane) {
        this.lane = new PortfolioLane(this.laneInput(this.results.length))
        const [attempts, successes] = this.lane.routingCounts()
        this.routeAttemptCountByRouteId = attempts
        this.routeSuccessCountByRouteId = successes
      }
      this.activeSubSolver = this.lane
      this.state = this.lane.state
      this.lane.step()
      this.stats = this.lane.stats
      if (!this.lane.solved && !this.lane.failed) continue
      const result = this.lane.result()
      this.results.push(result)
      this.lane = undefined
      if (
        (this.results.length === 1 && !result.diversified) ||
        this.results.length === 4
      ) {
        this.acceptResults(this.results)
      }
    }
  }

  private acceptResults(allResults: readonly LaneResult[]): void {
    const first = allResults[0]
    if (!first) throw new Error("Port-point portfolio has no candidates")
    const results = first.diversified ? allResults : [first]
    const successes = results.filter(
      (result): result is Extract<LaneResult, { status: "solved" }> =>
        result.status === "solved",
    )
    successes.sort(compareResults)
    const selected = successes[0]
    if (!selected)
      throw new Error(
        `Port-point portfolio exhausted all candidate budgets: ${results
          .map((result) => (result.status === "failed" ? result.error : ""))
          .join("; ")}`,
      )
    this.state = {
      ...selected.state,
      candidateQueue: this.canonicalQueue ?? this.state.candidateQueue,
    }
    this.state.candidateQueue.clear()
    this.routeAttemptCountByRouteId = selected.attempts
    this.routeSuccessCountByRouteId = selected.successes
    this.selectedBlockerStats = selected.blockerStats
    this.stats = {
      ...selected.stats,
      portfolioLaneCount: results.length,
      portfolioSelectedLane: selected.laneIndex,
      portfolioTotalLaneIterations: results.reduce(
        (sum, result) => sum + result.iterations,
        0,
      ),
      portfolioLaneSummaries: results.map((result) => ({
        laneIndex: result.laneIndex,
        status: result.status,
        iterations: result.iterations,
        ...(result.status === "solved"
          ? {
              maxCost: result.maxCost,
              totalCost: result.totalCost,
              layerChanges: result.layerChanges,
              segments: result.segments,
            }
          : { error: result.error }),
      })),
    }
    this.activeSubSolver = null
    this.solved = true
    this.failed = false
    this.error = null
  }

  override getSelectiveReripStats(): SelectiveReripTinyHyperGraphStats {
    return (
      this.selectedBlockerStats ??
      this.lane?.getSelectiveReripStats() ??
      super.getSelectiveReripStats()
    )
  }

  async solveAsync(
    runtime?: SolverRuntimeExecutor,
    stopAtIteration = Infinity,
  ): Promise<void> {
    if (this.asyncRunning)
      throw new Error("Port-point portfolio solveAsync is already running")
    const start = performance.now()
    this.asyncRunning = true
    try {
      this.setup()
      this.canonicalQueue ??= this.state.candidateQueue
      if (this.solved || this.failed) return
      if (
        !runtime ||
        this.iterations !== 0 ||
        stopAtIteration < this.MAX_ITERATIONS
      ) {
        while (
          !this.solved &&
          !this.failed &&
          this.iterations < stopAtIteration
        )
          this.step()
        return
      }
      const results = await Promise.all(
        [0, 1, 2, 3].map((index) =>
          runtime.executeAsync(
            TinyHyperGraphPortfolioLaneEvaluation,
            this.laneInput(index),
          ),
        ),
      )
      const used = results[0]!.diversified ? results : results.slice(0, 1)
      this.iterations = Math.ceil(
        used.reduce((sum, result) => sum + result.iterations, 0) / 2,
      )
      this.acceptResults(results)
    } catch (error) {
      this.failed = true
      this.error = `Port-point portfolio asynchronous solve error: ${error}`
      throw error
    } finally {
      this.asyncRunning = false
      this.timeToSolve = performance.now() - start
    }
  }
}
