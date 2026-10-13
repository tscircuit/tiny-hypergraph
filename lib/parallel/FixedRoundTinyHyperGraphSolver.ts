import {
  TinyHyperGraphSolver,
  getTinyHyperGraphSolverOptions,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import type {
  RoundTaskResult,
  RouteSearchResult,
  RoutingSnapshot,
} from "./protocol"
import { RouteSearchSolver } from "./RouteSearchSolver"
import { setNewIntersectionCounts } from "../countNewIntersections"
import {
  defaultWorkerCount,
  validateWorkerCount,
  WorkerPool,
} from "./WorkerPool"

export interface FixedRoundTinyHyperGraphSolverOptions
  extends TinyHyperGraphSolverOptions {
  workers?: number
  /** Algorithmic batch size, independent of the number of workers. */
  ROUND_SIZE?: number
  ROUTE_STEP_LIMIT?: number
  RETRIES_BEFORE_RIP?: number
  /** Persistent price added to a contested port. Zero disables negotiation. */
  PORT_CONFLICT_PENALTY?: number
}

/** Bulk-synchronous prototype: deterministic across worker counts, with a
 * potentially different result from the serial solver. Always use solveAsync(). */
export class FixedRoundTinyHyperGraphSolver extends TinyHyperGraphSolver {
  readonly workers: number
  readonly ROUND_SIZE: number
  readonly ROUTE_STEP_LIMIT: number
  readonly RETRIES_BEFORE_RIP: number
  readonly PORT_CONFLICT_PENALTY: number
  roundStats = {
    rounds: 0,
    searches: 0,
    searchSteps: 0,
    accepted: 0,
    portConflicts: 0,
    layerConflicts: 0,
    exhausted: 0,
    searchLimitReached: 0,
  }
  private dirtyRegions?: Set<number>
  private resetRegions = true
  private retryCounts: Uint32Array
  private running = false

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options: FixedRoundTinyHyperGraphSolverOptions = {},
  ) {
    super(
      topology,
      {
        ...problem,
        portPenalty: problem.portPenalty
          ? new Float64Array(problem.portPenalty)
          : new Float64Array(topology.portCount),
      },
      {
        ...options,
        MAX_ITERATIONS: options.MAX_ITERATIONS ?? 2_000_000,
        GREEDY_FINAL_ROUTE_ITERS: options.GREEDY_FINAL_ROUTE_ITERS ?? 0,
      },
    )
    this.workers = validateWorkerCount(options.workers ?? defaultWorkerCount())
    this.ROUND_SIZE = validateWorkerCount(options.ROUND_SIZE ?? 32)
    this.ROUTE_STEP_LIMIT = validateWorkerCount(
      options.ROUTE_STEP_LIMIT ?? 50_000,
    )
    this.RETRIES_BEFORE_RIP = validateWorkerCount(
      options.RETRIES_BEFORE_RIP ?? 8,
    )
    this.PORT_CONFLICT_PENALTY = options.PORT_CONFLICT_PENALTY ?? 1
    if (
      !Number.isFinite(this.PORT_CONFLICT_PENALTY) ||
      this.PORT_CONFLICT_PENALTY < 0
    )
      throw new Error("PORT_CONFLICT_PENALTY must be finite and nonnegative")
    if (!Number.isSafeInteger(this.MAX_ITERATIONS) || this.MAX_ITERATIONS < 1)
      throw new Error("MAX_ITERATIONS must be a positive integer")
    if (this.OWNED_REGIONAL_HOP_FRONTIER)
      throw new Error(
        "Fixed-round routing requires OWNED_REGIONAL_HOP_FRONTIER=false",
      )
    if (this.GREEDY_FINAL_ROUTE_ITERS !== 0)
      throw new Error("Fixed-round routing requires GREEDY_FINAL_ROUTE_ITERS=0")
    this.dirtyRegions = new Set()
    this.retryCounts = new Uint32Array(problem.routeCount)
  }

  override solve(): never {
    throw new Error(
      "Fixed-round routing requires await solveAsync(), including with workers=1",
    )
  }
  override _step(): never {
    throw new Error(
      "Fixed-round routing cannot be driven with step(); use solveAsync()",
    )
  }

  override appendSegmentToRegionCache(
    regionId: number,
    fromPortId: number,
    toPortId: number,
  ) {
    super.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    this.dirtyRegions?.add(regionId)
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.resetRegions = true
    this.dirtyRegions?.clear()
    this.retryCounts?.fill(0)
  }

  private takeSnapshot(): RoutingSnapshot {
    // One immutable copy per round, shared by all workers.
    const portAssignment = new Int32Array(
      new SharedArrayBuffer(this.state.portAssignment.byteLength),
    )
    portAssignment.set(this.state.portAssignment)
    const regionCongestionCost = new Float64Array(
      new SharedArrayBuffer(this.state.regionCongestionCost.byteLength),
    )
    regionCongestionCost.set(this.state.regionCongestionCost)
    const portPenalty = new Float64Array(
      new SharedArrayBuffer(this.problem.portPenalty!.byteLength),
    )
    portPenalty.set(this.problem.portPenalty!)
    const regions = this.resetRegions
      ? this.state.regionIntersectionCaches.flatMap((cache, regionId) =>
          cache.existingSegmentCount ? [regionId] : [],
        )
      : [...this.dirtyRegions!]
    return {
      portAssignment,
      portPenalty,
      regionCongestionCost,
      resetRegions: this.resetRegions,
      regionUpdates: regions.map((regionId) => ({
        regionId,
        cache: this.state.regionIntersectionCaches[regionId],
      })),
    }
  }

  private commitProposal(routeId: number, search: RouteSearchResult): boolean {
    if (search.failed)
      throw new Error(search.error ?? `Search failed for route ${routeId}`)
    if (!search.path) {
      if (search.exhausted) this.roundStats.exhausted++
      else this.roundStats.searchLimitReached++
      return false
    }
    this.state.currentRouteId = routeId
    this.state.currentRouteNetId = this.problem.routeNet[routeId]
    this.state.goalPortId = this.problem.routeEndPort[routeId]
    let candidate: Candidate | undefined
    for (const flat of search.path)
      candidate = { ...flat, prevCandidate: candidate }
    if (!candidate) throw new Error("Empty fixed-round proposal")
    const segments = this.getSolvedPathSegments(candidate)
    for (const { fromPortId, toPortId } of segments) {
      for (const portId of [fromPortId, toPortId]) {
        const assigned = this.state.portAssignment[portId]
        if (
          (assigned !== -1 && assigned !== this.state.currentRouteNetId) ||
          this.isPortReservedForDifferentNet(portId)
        ) {
          this.roundStats.portConflicts++
          // Include rejected proposals in congestion feedback. Prices survive
          // rerips so earlier winners can avoid the contested resource too.
          this.problem.portPenalty![portId] += this.PORT_CONFLICT_PENALTY
          return false
        }
      }
    }
    for (const { regionId, fromPortId, toPortId } of segments) {
      if (!this.isKnownSingleLayerRegion(regionId)) continue
      // Recheck hard single-layer feasibility against earlier commits. Changed
      // soft congestion costs do not invalidate an otherwise feasible proposal.
      const geometry = this.populateSegmentGeometryScratch(
        regionId,
        fromPortId,
        toPortId,
      )
      setNewIntersectionCounts(
        this.state.regionIntersectionCaches[regionId],
        geometry,
      )
      if (geometry.sameLayerIntersectionCount > 0) {
        this.roundStats.layerConflicts++
        return false
      }
    }
    this.onPathFound(candidate)
    this.roundStats.accepted++
    this.retryCounts[routeId] = 0
    return true
  }

  async solveAsync(): Promise<void> {
    if (this.constructor !== FixedRoundTinyHyperGraphSolver)
      throw new Error("Fixed-round workers do not support custom subclasses")
    if (this.running) throw new Error("solveAsync is already running")
    this.running = true
    const start = Date.now()
    let pool: WorkerPool | undefined
    try {
      this.setup()
      if (this.solved || this.failed) return
      const init = {
        kind: "init" as const,
        topology: this.topology,
        problem: this.problem,
        options: getTinyHyperGraphSolverOptions(this),
      }
      let local: RouteSearchSolver | undefined
      if (this.workers === 1) {
        local = new RouteSearchSolver(
          this.topology,
          { ...this.problem, initialAssignments: undefined },
          { ...init.options, STATIC_REACHABILITY_PRECHECK: false },
        )
        local.trackReads = false
        local.setup()
      } else {
        pool = new WorkerPool(
          Math.min(
            this.workers,
            this.ROUND_SIZE,
            Math.max(1, this.problem.routeCount),
          ),
        )
        await Promise.all(pool.slots.map((slot) => slot.run(init)))
      }
      this.resetRegions = true
      while (
        !this.solved &&
        !this.failed &&
        this.iterations < this.MAX_ITERATIONS
      ) {
        if (!this.state.unroutedRoutes.length) {
          this.onAllRoutesRouted()
          continue
        }
        const count = Math.min(
          this.ROUND_SIZE,
          this.state.unroutedRoutes.length,
          this.MAX_ITERATIONS - this.iterations,
        )
        const routeIds = this.state.unroutedRoutes.splice(0, count)
        const maxSteps = Math.min(
          this.ROUTE_STEP_LIMIT,
          Math.floor((this.MAX_ITERATIONS - this.iterations) / count),
        )
        const snapshot = this.takeSnapshot()
        let searches: RouteSearchResult[]
        if (local) {
          local.applySnapshot(snapshot)
          searches = routeIds.map((routeId) =>
            local!.searchRoute(routeId, maxSteps),
          )
        } else {
          const taskCounter = new Int32Array(new SharedArrayBuffer(4))
          const results = await Promise.all(
            pool!.slots.map((slot) =>
              slot.run<RoundTaskResult[]>({
                kind: "round",
                routeIds,
                taskCounter,
                snapshot,
                maxSteps,
              }),
            ),
          )
          searches = new Array(routeIds.length)
          for (const tasks of results)
            for (const { index, search } of tasks) {
              if (searches[index])
                throw new Error("Duplicate fixed-round task result")
              searches[index] = search
            }
          for (let index = 0; index < routeIds.length; index++) {
            if (!searches[index])
              throw new Error(`Missing fixed-round task result ${index}`)
          }
        }
        this.dirtyRegions!.clear()
        this.resetRegions = false
        this.roundStats.rounds++
        let mustRip = false
        for (let index = 0; index < routeIds.length; index++) {
          const routeId = routeIds[index],
            search = searches[index]
          this.iterations += search.steps
          this.roundStats.searchSteps += search.steps
          this.roundStats.searches++
          this.routeAttemptCountByRouteId[routeId]++
          if (!this.commitProposal(routeId, search)) {
            this.state.unroutedRoutes.push(routeId)
            this.retryCounts[routeId]++
            if (this.retryCounts[routeId] >= this.RETRIES_BEFORE_RIP)
              mustRip = true
          }
        }
        this.state.currentRouteId = undefined
        this.state.currentRouteNetId = undefined
        if (!this.state.unroutedRoutes.length) this.onAllRoutesRouted()
        else if (mustRip) this.onOutOfCandidates()
      }
      if (!this.solved && !this.failed) {
        this.tryFinalAcceptance()
        if (!this.solved) {
          this.failed = true
          this.error = `${this.getSolverName()} ran out of iterations`
        }
      }
    } catch (error) {
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      try {
        await pool?.close()
      } finally {
        this.running = false
        this.timeToSolve = Date.now() - start
      }
    }
  }
}
