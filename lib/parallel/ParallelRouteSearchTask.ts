import {
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import { SharedScoreSearchSolver } from "./SharedScoreSearchSolver"
import type { SharedTransitionScores } from "./SharedTransitionScores"
import { PackedRouteSearch } from "./PackedRouteSearch"
import type { SharedRouteContext } from "./SharedRouteGraph"
import { RouteSnapshot } from "./RouteSnapshot"

export type ParallelRouteSearchInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  context: SharedRouteContext
  transitionScores: SharedTransitionScores
  scoreStats: Float64Array
  workerIndex: number
  control: Int32Array
  budget: Float64Array
  pathIds: Int32Array
  pathCosts: Float64Array
  dependencies: Int32Array
  liveRegions: Int32Array
}

/** Runs the original TypeScript A*, capturing a result without committing it. */
class RouteSearchSolver extends SharedScoreSearchSolver {
  readonly regions = new Set<number>()
  candidate?: Candidate
  exhausted = false

  private packed?: PackedRouteSearch
  override onPathFound(candidate: Candidate): void {
    if (candidate.portId !== this.state.goalPortId) {
      super.onPathFound(candidate)
      return
    }
    this.candidate = candidate
    this.solved = true
  }

  override onOutOfCandidates(): void {
    this.exhausted = true
    this.solved = true
  }

  override tryFinalAcceptance(): void {}

  search(
    routeId: number,
    budget: number,
    control: Int32Array,
    onRegionRead?: (region: number) => boolean,
  ): void {
    this.candidate = undefined
    this.exhausted = false
    this.regions.clear()
    this.iterations = 0
    this.MAX_ITERATIONS = budget
    this.solved = false
    this.failed = false
    this.error = null
    this.packed ??= new PackedRouteSearch(this)
    const result = this.packed.search(
      routeId,
      budget,
      control,
      this.regions,
      onRegionRead,
    )
    this.candidate = result.candidate
    this.exhausted = result.exhausted
    this.iterations = result.iterations
    this.solved = !!result.candidate || result.exhausted
    this.failed = !this.solved && !result.canceled
  }
}

/** One persistent task per worker; graph snapshots and results use shared buffers. */
export class ParallelRouteSearchTask {
  static readonly solverName = "ParallelRouteSearchTask"
  constructor(private readonly input: ParallelRouteSearchInput) {}

  solve(): void {
    const {
      topology,
      problem,
      options,
      control,
      budget,
      context,
      pathIds,
      pathCosts,
      dependencies,
    } = this.input
    try {
      const solver = new RouteSearchSolver(topology, problem, {
        ...options,
        STATIC_REACHABILITY_PRECHECK: false,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        VERBOSE: false,
      })
      const snapshot = new RouteSnapshot(solver, context)
      solver.setup()
      const versions = snapshot.versions
      solver.transitionScores = this.input.transitionScores
      solver.regionVersions = versions
      solver.scoreWorkerIndex = this.input.workerIndex
      Atomics.store(control, 7, 1)
      Atomics.notify(control, 7)
      while (true) {
        const state = Atomics.load(control, 0)
        if (state === 3) return
        if (state !== 1) {
          Atomics.wait(control, 0, state, 100)
          continue
        }
        const snapshotTimeStart = snapshot.timeMs
        snapshot.refresh()
        const initialCopyMs = snapshot.timeMs - snapshotTimeStart
        const searchStart = performance.now()
        solver.sharedScoreHits = 0
        solver.crossWorkerScoreHits = 0
        solver.sharedScoreMisses = 0
        solver.search(
          control[1]!,
          budget[0]!,
          control,
          this.input.liveRegions.length > 0
            ? (region): boolean => {
                // Publish before checking the version: a concurrent update either
                // sees this read or is detected by the following version check.
                Atomics.store(this.input.liveRegions, region, control[2]!)
                if (
                  Atomics.load(context.headers, region * 8) === versions[region]
                )
                  return true
                Atomics.store(control, 9, 1)
                return false
              }
            : undefined,
        )
        const elapsed = performance.now() - searchStart
        this.input.scoreStats[0] = solver.sharedScoreHits
        this.input.scoreStats[1] = solver.crossWorkerScoreHits
        this.input.scoreStats[2] = solver.sharedScoreMisses
        budget[1] = snapshot.timeMs - snapshotTimeStart
        budget[2] = Math.max(0, elapsed - (budget[1]! - initialCopyMs))
        if (Atomics.load(control, 0) === 3) return
        const canceled = Atomics.load(control, 9) !== 0
        let count = 0
        for (
          let candidate = solver.candidate;
          candidate;
          candidate = candidate.prevCandidate
        ) {
          if (count * 4 + 3 >= pathIds.length)
            throw new Error("Route result exceeds hop capacity")
          pathIds[count * 4] = candidate.portId
          pathIds[count * 4 + 1] = candidate.nextRegionId
          pathIds[count * 4 + 2] =
            candidate.hopId ??
            solver.getHopId(candidate.portId, candidate.nextRegionId)
          pathIds[count * 4 + 3] = candidate.prevRegionId ?? -1
          pathCosts[count * 3] = candidate.f
          pathCosts[count * 3 + 1] = candidate.g
          pathCosts[count * 3 + 2] = candidate.h
          count++
        }
        let index = 0
        for (const region of solver.regions) {
          dependencies[index * 2] = region
          dependencies[index * 2 + 1] = versions[region]!
          index++
        }
        control[3] = canceled
          ? 4
          : solver.candidate
            ? 1
            : solver.exhausted
              ? 2
              : 3
        control[4] = solver.iterations
        control[5] = count
        control[6] = index
        if (Atomics.compareExchange(control, 0, 1, 2) !== 1) return
        Atomics.notify(control, 0)
        // The coordinator acknowledges the buffers before assigning new work.
        while (Atomics.load(control, 0) === 2) Atomics.wait(control, 0, 2, 100)
      }
    } catch (error) {
      Atomics.store(control, 0, -1)
      Atomics.notify(control, 0)
      Atomics.notify(control, 7)
      throw error
    }
  }

  getOutput(): Record<string, never> {
    return {}
  }
}
