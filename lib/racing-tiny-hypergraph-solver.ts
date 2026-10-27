import {
  BaseSolver,
  SolverRuntime,
  type SolverRuntimeExecutor,
} from "@tscircuit/solver-utils"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
  type TinyHyperGraphWorkingState,
} from "./core"
import { StableInitialAssignmentsTinyHyperGraphSolver } from "./stable-initial-assignments-tiny-hypergraph-solver"

export const TINY_HYPERGRAPH_RACE_CANDIDATE_COUNT = 4

export type TinyHyperGraphRaceOptions = TinyHyperGraphSolverOptions & {
  /** Preserve serialized copper across global retries. */
  raceUseSelectiveRerip?: boolean
}

type CompletedState = Pick<
  TinyHyperGraphWorkingState,
  | "portAssignment"
  | "regionSegments"
  | "regionIntersectionCaches"
  | "regionCongestionCost"
  | "ripCount"
>

export type TinyHyperGraphRaceCandidateInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphRaceOptions
  candidateIndex: number
  bestIteration: SharedArrayBuffer
}

export type TinyHyperGraphRaceCandidateResult = {
  candidateIndex: number
  iterations: number
  status: "solved" | "failed" | "superseded"
  error: string | null
  stats: Record<string, unknown>
  state?: CompletedState
}

/** Every execution mode uses the same four inputs; candidate zero is unchanged. */
export function createTinyHyperGraphRaceCandidate(
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options: TinyHyperGraphRaceOptions,
  candidateIndex: number,
): TinyHyperGraphSolver {
  if (
    !Number.isInteger(candidateIndex) ||
    candidateIndex < 0 ||
    candidateIndex >= TINY_HYPERGRAPH_RACE_CANDIDATE_COUNT
  ) {
    throw new Error("Invalid tiny hypergraph race candidate " + candidateIndex)
  }
  const Solver = options.raceUseSelectiveRerip
    ? StableInitialAssignmentsTinyHyperGraphSolver
    : TinyHyperGraphSolver
  const solver = new Solver(topology, problem, {
    ...options,
    DISTANCE_TO_COST:
      (options.DISTANCE_TO_COST ?? 0.05) * [1, 4, 10, 20][candidateIndex],
  })
  // Three 1/8-budget alternatives add at most 37.5% logical search work if
  // all fail. Native timeout finalization still requires a complete graph.
  if (candidateIndex > 0)
    solver.MAX_ITERATIONS = Math.max(1, Math.ceil(solver.MAX_ITERATIONS / 8))
  const routeDistance = (routeId: number): number => {
    const start = problem.routeStartPort[routeId]
    const end = problem.routeEndPort[routeId]
    return Math.hypot(
      topology.portX[start] - topology.portX[end],
      topology.portY[start] - topology.portY[end],
    )
  }
  if (candidateIndex === 1) solver.state.unroutedRoutes.reverse()
  if (candidateIndex >= 2) {
    solver.state.unroutedRoutes.sort(
      (a, b) =>
        (candidateIndex === 2 ? 1 : -1) *
          (routeDistance(a) - routeDistance(b)) || a - b,
    )
  }
  return solver
}

export function getTinyHyperGraphRaceCandidateResult(
  solver: TinyHyperGraphSolver,
  candidateIndex: number,
): TinyHyperGraphRaceCandidateResult {
  const status = solver.failed
    ? "failed"
    : solver.solved
      ? "solved"
      : "superseded"
  return {
    candidateIndex,
    iterations: solver.iterations,
    status,
    error: solver.error,
    stats: { ...solver.stats },
    ...(status === "solved"
      ? {
          state: {
            portAssignment: solver.state.portAssignment,
            regionSegments: solver.state.regionSegments,
            regionIntersectionCaches: solver.state.regionIntersectionCaches,
            regionCongestionCost: solver.state.regionCongestionCost,
            ripCount: solver.state.ripCount,
          },
        }
      : {}),
  }
}

/** Shared cancellation is based on logical work, never elapsed time. */
export class TinyHyperGraphRaceCandidateSolver extends BaseSolver {
  static readonly solverName = "TinyHyperGraphRaceCandidateSolver"
  private output?: TinyHyperGraphRaceCandidateResult

  constructor(private readonly input: TinyHyperGraphRaceCandidateInput) {
    super()
  }

  override _step(): void {
    const { topology, problem, options, candidateIndex, bestIteration } =
      this.input
    const solver = createTinyHyperGraphRaceCandidate(
      topology,
      problem,
      options,
      candidateIndex,
    )
    const bound = new Int32Array(bestIteration)
    while (!solver.solved && !solver.failed) {
      // Run through a tied completion step so lower indices can still win.
      if (solver.iterations >= Atomics.load(bound, 0)) break
      solver.step()
    }
    if (solver.solved && !solver.failed) {
      let previous = Atomics.load(bound, 0)
      while (solver.iterations < previous) {
        const observed = Atomics.compareExchange(
          bound, 0, previous, solver.iterations,
        )
        if (observed === previous) break
        previous = observed
      }
    }
    this.output = getTinyHyperGraphRaceCandidateResult(solver, candidateIndex)
    this.solved = true
  }

  override getOutput(): TinyHyperGraphRaceCandidateResult {
    if (!this.output)
      throw new Error("Tiny hypergraph race candidate has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHyperGraphRaceCandidateSolver)

/** Four logical lanes; step, sync and async select identical routed output. */
export class RacingTinyHyperGraphSolver extends TinyHyperGraphSolver {
  private candidates?: TinyHyperGraphSolver[]
  private asyncRunning = false
  readonly raceOptions: TinyHyperGraphRaceOptions

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: TinyHyperGraphRaceOptions = {},
  ) {
    super(topology, problem, options)
    this.raceOptions = options
    // Preserve detailed candidate errors when their final step exhausts work.
    this.MAX_ITERATIONS += 1
  }

  override _setup(): void {
    this.candidates = Array.from(
      { length: TINY_HYPERGRAPH_RACE_CANDIDATE_COUNT },
      (_, index) =>
        createTinyHyperGraphRaceCandidate(
          this.topology, this.problem, this.raceOptions, index,
        ),
    )
  }

  // Acceptance belongs to the four candidates. Do not launch an implicit
  // fifth greedy solver via the inherited timeout finalizer.
  override tryFinalAcceptance(): void {}

  override _step(): void {
    if (this.asyncRunning)
      throw new Error("Cannot step an asynchronously running hypergraph race")
    const candidates = this.candidates!
    // Finish the whole logical round before selecting a tied winner.
    for (const candidate of candidates) candidate.step()
    if (
      candidates.some(({ solved }) => solved) ||
      candidates.every(({ failed }) => failed)
    ) {
      this.acceptResults(candidates.map(getTinyHyperGraphRaceCandidateResult))
    }
  }

  private acceptResults(results: TinyHyperGraphRaceCandidateResult[]): void {
    const winner = results
      .filter(({ status }) => status === "solved")
      .sort(
        (a, b) =>
          a.iterations - b.iterations || a.candidateIndex - b.candidateIndex,
      )[0]
    this.stats = {
      ...winner?.stats,
      raceCandidateCount: TINY_HYPERGRAPH_RACE_CANDIDATE_COUNT,
      raceWinningCandidateIndex: winner?.candidateIndex,
      raceWinningIterations: winner?.iterations,
      raceCandidates: results.map(
        ({ candidateIndex, iterations, status, error }) => ({
          candidateIndex, iterations, status, error,
        }),
      ),
    }
    if (!winner) {
      this.failed = true
      this.error = results
        .map(({ candidateIndex, error }) => "Candidate " + candidateIndex + ": " + error)
        .join("; ")
      return
    }
    if (!winner.state)
      throw new Error("Solved hypergraph race candidate is missing its state")
    Object.assign(this.state, winner.state)
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = []
    this.state.candidateQueue.clear()
    this.solved = true
    this.failed = false
    this.error = null
    this.progress = 1
    this.candidates = undefined
  }

  async solveAsync(
    runtime?: SolverRuntimeExecutor,
    stopAtIteration = Infinity,
  ): Promise<void> {
    if (this.asyncRunning)
      throw new Error("Hypergraph race solveAsync is already running")
    if (this.solved || this.failed || this.iterations >= stopAtIteration)
      return
    if (
      runtime === undefined ||
      typeof SharedArrayBuffer === "undefined" ||
      this.iterations > 0 ||
      stopAtIteration < this.MAX_ITERATIONS
    ) {
      while (
        !this.solved &&
        !this.failed &&
        this.iterations < stopAtIteration
      ) this.step()
      return
    }
    this.asyncRunning = true
    const start = performance.now()
    try {
      const bestIteration = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
      Atomics.store(new Int32Array(bestIteration), 0, 0x7fffffff)
      const results = await Promise.all(
        Array.from(
          { length: TINY_HYPERGRAPH_RACE_CANDIDATE_COUNT },
          (_, candidateIndex) =>
            runtime.executeAsync(TinyHyperGraphRaceCandidateSolver, {
              topology: this.topology,
              problem: this.problem,
              options: this.raceOptions,
              candidateIndex,
              bestIteration,
            }),
        ),
      )
      this.acceptResults(results)
      this._setupDone = true
      this.iterations = Math.max(
        ...results
          .filter(({ status }) => status !== "superseded")
          .map(({ iterations }) => iterations),
      )
      if (this.solved)
        this.iterations = Number(this.stats.raceWinningIterations)
    } catch (error) {
      this.failed = true
      this.error = "Tiny hypergraph asynchronous race failed: " + error
      throw error
    } finally {
      this.asyncRunning = false
      this.timeToSolve = performance.now() - start
    }
  }
}
