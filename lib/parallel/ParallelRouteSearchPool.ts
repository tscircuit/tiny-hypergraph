import {
  type Candidate,
  type TinyHyperGraphSolver,
  getTinyHyperGraphSolverOptions,
} from "../core"
import type {
  OutsideInPartialRipTinyHyperGraphSolver,
  PartialRouteSearchState,
  PartialRouteSearchStats,
} from "../outside-in-partial-rip-tiny-hypergraph-solver"
import {
  ParallelRouteSearchTask,
  type ParallelRouteSearchInput,
} from "./ParallelRouteSearchTask"
import { SharedRouteGraph } from "./SharedRouteGraph"

export interface ParallelSearchExecutor {
  persistentWorkerCount?: number
  executeAsync(
    Task: typeof ParallelRouteSearchTask,
    input: ParallelRouteSearchInput,
  ): Promise<unknown>
}
export type RouteSearchResult = {
  status: "found" | "exhausted" | "budget" | "canceled" | "stale"
  iterations: number
  candidate?: Candidate
  dependencies: Int32Array
  partial?: PartialRouteSearchStats
}
type Slot = {
  input: ParallelRouteSearchInput
  completion: Promise<unknown>
  busy: boolean
  active?: Promise<RouteSearchResult>
  error?: unknown
}
type Job = {
  slot: Slot
  promise: Promise<RouteSearchResult>
  done: boolean
  generation: number
  result?: RouteSearchResult
  planKey: string
}

// Completion candidates change rerip policies and iteration limits, but the
// persistent worker only needs a new solver when A* scoring/storage changes.
function getSearchSignature(solver: TinyHyperGraphSolver): string {
  return JSON.stringify({
    distance: solver.DISTANCE_TO_COST,
    lazyHeuristic: solver.USE_LAZY_ROUTE_HEURISTIC,
    sparseStorage: solver.USE_SPARSE_CANDIDATE_STORAGE,
    regionalFrontier: solver.OWNED_REGIONAL_HOP_FRONTIER,
    viaDiameter: solver.minViaPadDiameter,
    traceDensity: solver.TRACE_DENSITY_COST_FACTOR,
  })
}

/** Optimistic searches run concurrently; only the coordinator commits routes. */
export class ParallelRouteSearchPool {
  readonly workerCount: number
  searches = 0
  finishedSearches = 0
  acceptedExpansions = 0
  private readonly participatingSlots = new Set<Slot>()
  private readonly partialSlots = new Set<Slot>()
  acceptedSearches = 0
  staleSearches = 0
  speculativeExpansions = 0
  maximumConcurrentSearches = 0
  workerSearchMs = 0
  workerSnapshotMs = 0
  graphSyncMs = 0
  waitForRouteMs = 0
  private readonly graph: SharedRouteGraph
  private readonly slots: Slot[] = []
  private readonly jobs = new Map<number, Job>()
  private readonly committing = new Set<number>()
  private failure?: { error: unknown }
  private disposed = false
  private budget = 0
  private readonly signature: string

  constructor(
    private solver: TinyHyperGraphSolver,
    private readonly executor: ParallelSearchExecutor,
  ) {
    const count = executor.persistentWorkerCount
    if (count !== 1 && count !== 4)
      throw new Error("Parallel routing requires one or four verified workers")
    this.workerCount = count
    this.graph = new SharedRouteGraph(solver)
    this.signature = getSearchSignature(solver)
  }

  canReuse(solver: TinyHyperGraphSolver): boolean {
    return (
      this.solver.topology === solver.topology &&
      this.solver.problem === solver.problem &&
      this.signature === getSearchSignature(solver)
    )
  }

  rebind(solver: TinyHyperGraphSolver): void {
    this.cancelJobs()
    this.solver = solver
    this.graph.rebind(solver)
  }

  async start(): Promise<void> {
    const solver = this.solver
    const stride = solver.topology.incidentPortRegion.reduce(
      (max, regions) => Math.max(max, regions.length),
      1,
    )
    const capacity = solver.topology.portCount * stride + 1
    for (let index = 0; index < this.workerCount; index++) {
      const input: ParallelRouteSearchInput = {
        topology: solver.topology,
        problem: solver.problem,
        options: getTinyHyperGraphSolverOptions(solver),
        context: this.graph.context,
        control: new Int32Array(new SharedArrayBuffer(10 * 4)),
        budget: new Float64Array(new SharedArrayBuffer(3 * 8)),
        pathIds: new Int32Array(new SharedArrayBuffer(capacity * 4 * 4)),
        pathCosts: new Float64Array(new SharedArrayBuffer(capacity * 3 * 8)),
        dependencies: new Int32Array(
          new SharedArrayBuffer(solver.topology.regionCount * 2 * 4),
        ),
        liveRegions: new Int32Array(
          new SharedArrayBuffer(
            this.workerCount > 1 ? solver.topology.regionCount * 4 : 0,
          ),
        ),
        partialPlan: new Float64Array(new SharedArrayBuffer(12 * 8)),
        partialStats: new Float64Array(new SharedArrayBuffer(8 * 8)),
      }
      const slot: Slot = { input, busy: false, completion: Promise.resolve() }
      this.slots.push(slot)
      slot.completion = this.executor
        .executeAsync(ParallelRouteSearchTask, input)
        .catch((error: unknown) => {
          slot.error = error
          Atomics.store(input.control, 0, -1)
          Atomics.notify(input.control, 0)
          Atomics.notify(input.control, 7)
        })
    }
    for (const slot of this.slots) {
      while (Atomics.load(slot.input.control, 7) !== 1) {
        if (Atomics.load(slot.input.control, 0) === -1) {
          await slot.completion
          throw slot.error
        }
        await this.wait(slot.input.control, 7, 0)
      }
    }
  }

  private async wait(
    control: Int32Array,
    index: number,
    value: number,
  ): Promise<void> {
    const pending = Atomics.waitAsync(control, index, value, 100)
    if (pending.async) await pending.value
  }

  private async execute(slot: Slot): Promise<RouteSearchResult> {
    const { control, pathIds, pathCosts, dependencies } = slot.input
    while (Atomics.load(control, 0) === 1) await this.wait(control, 0, 1)
    if (Atomics.load(control, 0) === -1) {
      await slot.completion
      throw slot.error
    }
    if (Atomics.load(control, 0) === 3)
      return {
        status: "canceled",
        iterations: 0,
        dependencies: new Int32Array(0),
      }
    let candidate: Candidate | undefined
    for (let index = control[5]! - 1; index >= 0; index--) {
      const previousRegion = pathIds[index * 4 + 3]!
      candidate = {
        portId: pathIds[index * 4]!,
        nextRegionId: pathIds[index * 4 + 1]!,
        hopId: pathIds[index * 4 + 2]!,
        ...(previousRegion === -1 ? {} : { prevRegionId: previousRegion }),
        f: pathCosts[index * 3]!,
        g: pathCosts[index * 3 + 1]!,
        h: pathCosts[index * 3 + 2]!,
        ...(candidate ? { prevCandidate: candidate } : {}),
      }
    }
    const result: RouteSearchResult = {
      status: (["found", "exhausted", "budget", "canceled", "stale"] as const)[
        control[3]! - 1
      ]!,
      iterations: control[4]!,
      candidate,
      dependencies: dependencies.slice(0, control[6]! * 2),
    }
    this.finishedSearches++
    if (slot.input.partialPlan[0] === 1) {
      const stats = slot.input.partialStats
      result.partial = {
        routes: stats[0]!,
        completed: stats[1]!,
        fallbacks: stats[2]!,
        forward: stats[3]!,
        reverse: stats[4]!,
        pruned: stats[5]!,
        attempts: stats[6]!,
        oneSidedFallbackRouteId: stats[7]! < 0 ? undefined : stats[7]!,
      }
      if (result.iterations > 0) this.partialSlots.add(slot)
    }
    if (result.iterations > 0) this.participatingSlots.add(slot)
    this.speculativeExpansions += result.iterations
    this.workerSnapshotMs += slot.input.budget[1]!
    this.workerSearchMs += slot.input.budget[2]!
    Atomics.store(control, 0, 0)
    Atomics.notify(control, 0)
    return result
  }

  private schedule(): void {
    if (this.disposed || this.failure) return
    // Leave a completed head's worker free until the coordinator validates it.
    // Otherwise speculative lookahead can occupy every worker before a stale
    // head is retried, putting unrelated searches on the commit critical path.
    const head = this.solver.state.unroutedRoutes[0]
    const completedHead = head === undefined ? undefined : this.jobs.get(head)
    if (completedHead?.done && completedHead.result?.status !== "found") return
    const reserveRetry = completedHead?.done === true
    let free = this.slots.filter((slot) => !slot.busy).length
    const routes = this.solver.state.unroutedRoutes.slice(0, this.workerCount)
    for (const slot of this.slots) {
      if (slot.busy) continue
      if (reserveRetry && free <= 1) break
      const route = routes.find(
        (routeId) =>
          !this.jobs.has(routeId) &&
          !this.committing.has(routeId) &&
          this.canSearch(routeId),
      )
      if (route === undefined) break
      slot.busy = true
      free--
      slot.input.control[1] = route
      const partial = this.getPartialState(route)
      slot.input.partialPlan.fill(0)
      if (partial)
        slot.input.partialPlan.set([
          1,
          partial.activeStartPortId,
          partial.activeEndPortId,
          partial.forcedStartRegionId,
          partial.forcedEndRegionId,
          partial.rippedSegmentCount,
          partial.retainedSegmentCount,
          partial.ripCount,
          partial.oneSidedFallbackRouteId ?? -1,
          partial.partialRipEnabled ? 1 : 0,
          partial.outsideInRouting ? 1 : 0,
          partial.maxDistance,
        ])
      slot.input.control[2] = (slot.input.control[2]! + 1) | 0
      if (slot.input.control[2] === 0) {
        slot.input.liveRegions.fill(0)
        slot.input.control[2] = 1
      }
      slot.input.budget[0] = this.budget
      Atomics.store(slot.input.control, 9, 0)
      Atomics.store(slot.input.control, 0, 1)
      Atomics.notify(slot.input.control, 0)
      this.searches++
      this.maximumConcurrentSearches = Math.max(
        this.maximumConcurrentSearches,
        this.slots.filter((worker) => worker.busy).length,
      )
      let job!: Job
      const promise = this.execute(slot).then((result) => {
        job.result = result
        job.done = true
        slot.busy = false
        if (
          result.status === "canceled" &&
          route !== this.solver.state.unroutedRoutes[0] &&
          this.jobs.get(route) === job
        ) {
          this.jobs.delete(route)
          this.staleSearches++
        }
        this.schedule()
        return result
      })
      // Store rejected speculative jobs until consumption without allowing an
      // unhandled rejection to hide an eventual worker failure.
      void promise.catch((error: unknown) => {
        this.failure = { error }
      })
      slot.active = promise
      job = {
        slot,
        promise,
        done: false,
        generation: this.graph.generation,
        planKey: this.planKey(partial),
      }
      this.jobs.set(route, job)
    }
  }

  private cancelJobs(): void {
    for (const job of this.jobs.values())
      if (!job.done) Atomics.store(job.slot.input.control, 9, 1)
    this.jobs.clear()
    this.committing.clear()
  }

  async search(routeId: number, budget: number): Promise<RouteSearchResult> {
    this.budget = budget
    this.committing.clear()
    const syncStart = performance.now()
    this.graph.sync()
    this.graphSyncMs += performance.now() - syncStart
    for (const job of this.jobs.values()) {
      if (job.done) continue
      const { liveRegions, control } = job.slot.input
      if (liveRegions.length === 0) continue
      if (
        this.graph.changedRegions.some(
          (region) => Atomics.load(liveRegions, region) === control[2],
        )
      )
        Atomics.store(control, 9, 1)
    }
    const waitStart = performance.now()
    const pendingRoutes = new Set(this.solver.state.unroutedRoutes)
    for (const [route, job] of this.jobs) {
      if (
        pendingRoutes.has(route) &&
        this.canSearch(route) &&
        job.planKey === this.planKey(this.getPartialState(route)) &&
        (job.done || job.generation === this.graph.generation)
      )
        continue
      if (!job.done) Atomics.store(job.slot.input.control, 9, 1)
      if (
        job.generation !== this.graph.generation ||
        job.planKey !== this.planKey(this.getPartialState(route))
      )
        this.staleSearches++
      this.jobs.delete(route)
    }
    while (true) {
      if (this.failure) throw this.failure.error
      this.schedule()
      let job = this.jobs.get(routeId)
      if (!job) {
        // Canceled work can still occupy a worker until its next checkpoint.
        const active = this.slots
          .filter((slot) => slot.busy)
          .map((slot) => slot.active!)
        if (active.length === 0)
          throw new Error("No worker scheduled the current route")
        await Promise.race(active)
        continue
      }
      const result = await job.promise
      this.jobs.delete(routeId)
      const dependencies = result.dependencies
      let valid = result.status !== "canceled" && result.status !== "stale"
      if (result.partial && result.iterations > budget) valid = false
      for (let index = 0; valid && index < dependencies.length; index += 2)
        valid =
          dependencies[index + 1] ===
          Atomics.load(this.graph.context.headers, dependencies[index]! * 8)
      if (!valid) {
        this.staleSearches++
        continue
      }
      this.committing.add(routeId)
      this.acceptedSearches++
      this.acceptedExpansions += result.iterations
      this.waitForRouteMs += performance.now() - waitStart
      if (result.status === "found") this.schedule()
      return result
    }
  }

  private canSearch(route: number): boolean {
    return (
      !("canSearchRouteInParallel" in this.solver) ||
      (
        this.solver as OutsideInPartialRipTinyHyperGraphSolver
      ).canSearchRouteInParallel(route)
    )
  }

  private getPartialState(route: number): PartialRouteSearchState | undefined {
    return "getPartialRouteSearchState" in this.solver
      ? (
          this.solver as OutsideInPartialRipTinyHyperGraphSolver
        ).getPartialRouteSearchState(route)
      : undefined
  }

  private planKey(plan: PartialRouteSearchState | undefined): string {
    return plan
      ? [
          plan.activeStartPortId,
          plan.activeEndPortId,
          plan.forcedStartRegionId,
          plan.forcedEndRegionId,
          plan.rippedSegmentCount,
          plan.retainedSegmentCount,
          plan.ripCount,
          plan.oneSidedFallbackRouteId ?? -1,
          plan.partialRipEnabled ? 1 : 0,
          plan.outsideInRouting ? 1 : 0,
          plan.maxDistance,
        ].join(",")
      : "whole"
  }

  get searchMs(): number {
    return this.waitForRouteMs + this.graphSyncMs
  }
  get maximumParticipatingWorkers(): number {
    return this.participatingSlots.size
  }
  get maximumParticipatingPartialWorkers(): number {
    return this.partialSlots.size
  }
  get totals(): { expansions: number; messages: number; batches: number } {
    return {
      expansions: this.acceptedExpansions,
      messages: 0,
      batches: this.acceptedSearches,
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const slot of this.slots) {
      Atomics.store(slot.input.control, 0, 3)
      Atomics.notify(slot.input.control, 0)
    }
    await Promise.all(this.slots.map((slot) => slot.completion))
    const failed = this.slots.find((slot) => slot.error !== undefined)
    if (failed) throw failed.error
    if (this.failure) throw this.failure.error
  }
}
