import {
  TinyHyperGraphSolver,
  getTinyHyperGraphSolverOptions,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type { RouteSearchResult, RoutingSnapshot } from "./protocol"
import {
  defaultWorkerCount,
  validateWorkerCount,
  WorkerPool,
} from "./WorkerPool"

export interface ParallelTinyHyperGraphSolverOptions
  extends TinyHyperGraphSolverOptions {
  workers?: number
}

/** Bun server API. Call solveAsync(); synchronous solve() retains serial behavior. */
export class ParallelTinyHyperGraphSolver extends TinyHyperGraphSolver {
  readonly workers: number
  parallelStats = { searches: 0, reusedSearches: 0, invalidatedSearches: 0 }
  private replay?: RouteSearchResult
  // Base construction can insert initial assignments through our virtual
  // append hook before these tracking fields have been initialized.
  private regionVersions?: Float64Array
  private dirtyRegions?: Set<number>
  private resetRegions = true
  private running = false

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: ParallelTinyHyperGraphSolverOptions = {},
  ) {
    super(topology, problem, options)
    this.workers = validateWorkerCount(options.workers ?? defaultWorkerCount())
    this.regionVersions = new Float64Array(topology.regionCount)
    this.dirtyRegions = new Set()
  }

  override getSolverName() {
    return "TinyHyperGraphSolver"
  }

  override appendSegmentToRegionCache(
    regionId: number,
    fromPortId: number,
    toPortId: number,
  ) {
    super.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    if (this.regionVersions) this.regionVersions[regionId]++
    this.dirtyRegions?.add(regionId)
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.resetRegions = true
    this.dirtyRegions?.clear()
  }

  override _step() {
    const replay = this.replay
    if (!replay) return super._step()
    this.replay = undefined
    const routeId = this.state.unroutedRoutes.shift()!
    this.state.currentRouteId = routeId
    this.state.currentRouteNetId = this.problem.routeNet[routeId]
    this.routeAttemptCountByRouteId[routeId]++
    this.resetCandidateBestCosts()
    this.state.candidateQueue.clear()
    this.state.goalPortId = this.problem.routeEndPort[routeId]
    if (replay.exhausted) return this.onOutOfCandidates()
    let candidate: Candidate | undefined
    for (const flat of replay.path!)
      candidate = { ...flat, prevCandidate: candidate }
    if (!candidate) throw new Error("Worker returned an empty route path")
    this.onPathFound(candidate)
  }

  async solveAsync(): Promise<void> {
    if (this.constructor !== ParallelTinyHyperGraphSolver) {
      throw new Error(
        "solveAsync supports the base TinyHyperGraphSolver algorithm only; custom subclasses require a matching worker implementation",
      )
    }
    if (this.running) throw new Error("solveAsync is already running")
    this.running = true
    const start = Date.now()
    let pool: WorkerPool | undefined
    try {
      this.setup()
      // The owned frontier uses additional pruning state; retain its serial
      // implementation until its complete read set is exposed by core.ts.
      if (this.workers === 1 || this.OWNED_REGIONAL_HOP_FRONTIER) {
        super.solve()
        return
      }
      if (this.solved || this.failed) return
      this.resetRegions = true
      pool = new WorkerPool(this.workers)
      await Promise.all(
        pool.slots.map((slot) =>
          slot.run({
            kind: "init",
            topology: this.topology,
            problem: this.problem,
            options: getTinyHyperGraphSolverOptions(this),
          }),
        ),
      )
      while (!this.solved && !this.failed) {
        if (
          this.state.currentRouteId !== undefined ||
          this.state.unroutedRoutes.length === 0
        ) {
          this.step()
          continue
        }
        const routeIds = this.state.unroutedRoutes.slice(0, this.workers)
        const ripCount = this.state.ripCount
        const versions = this.regionVersions!.slice()
        const changedRegions = this.resetRegions
          ? this.state.regionIntersectionCaches.flatMap((cache, regionId) =>
              cache.existingSegmentCount ? [regionId] : [],
            )
          : [...this.dirtyRegions!]
        const snapshot: RoutingSnapshot = {
          portAssignment: this.state.portAssignment.slice(),
          regionUpdates: changedRegions.map((regionId) => ({
            regionId,
            cache: this.state.regionIntersectionCaches[regionId],
          })),
          resetRegions: this.resetRegions,
          regionCongestionCost: this.state.regionCongestionCost,
        }
        // postMessage copies all deltas before the coordinator commits any path.
        const pendingSearches = routeIds.map((routeId, index) =>
          pool!.slots[index].run<RouteSearchResult>({
            kind: "route",
            routeId,
            snapshot,
            maxSteps: Math.max(1, this.MAX_ITERATIONS - this.iterations),
          }),
        )
        this.dirtyRegions!.clear()
        this.resetRegions = false
        const searches = await Promise.all(pendingSearches)
        this.parallelStats.searches += searches.length
        for (
          let index = 0;
          index < routeIds.length && !this.solved && !this.failed;
          index++
        ) {
          if (this.state.ripCount !== ripCount) break
          const search = searches[index]
          const valid =
            (search.path || search.exhausted) &&
            search.steps < this.MAX_ITERATIONS - this.iterations &&
            search.readPorts.every(
              (portId) =>
                snapshot.portAssignment[portId] ===
                this.state.portAssignment[portId],
            ) &&
            search.readRegions.every(
              (regionId) =>
                versions[regionId] === this.regionVersions![regionId],
            )
          if (valid) {
            this.parallelStats.reusedSearches++
            this.replay = search
            this.iterations += search.steps - 1
            this.step() // Preserve BaseSolver timeout/final-acceptance semantics.
          } else {
            this.parallelStats.invalidatedSearches++
            do {
              this.step()
            } while (
              !this.solved &&
              !this.failed &&
              this.state.currentRouteId !== undefined
            )
          }
        }
      }
    } finally {
      try {
        await pool?.close()
      } finally {
        this.timeToSolve = Date.now() - start
        this.running = false
      }
    }
  }
}
