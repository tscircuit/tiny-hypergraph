import {
  type Candidate,
  type TinyHyperGraphSolver,
  getTinyHyperGraphSolverOptions,
} from "../core"
import type { OutsideInPartialRipTinyHyperGraphSolver } from "../outside-in-partial-rip-tiny-hypergraph-solver"
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
  terminalRegions?: Int32Array
  terminalCosts?: Float64Array
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
  certifiedSearches = 0
  private readonly participatingSlots = new Set<Slot>()
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
        terminalRegions: new Int32Array(
          new SharedArrayBuffer((stride + 1) * 4),
        ),
        terminalCosts: new Float64Array(
          new SharedArrayBuffer((stride + 1) * 8),
        ),
        dependencies: new Int32Array(
          new SharedArrayBuffer(solver.topology.regionCount * 2 * 4),
        ),
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
      terminalRegions: slot.input.terminalRegions.slice(0, control[8]!),
      terminalCosts: slot.input.terminalCosts.slice(0, control[8]!),
    }
    this.finishedSearches++
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
    if (
      head !== undefined &&
      (this.jobs.get(head)?.done || this.committing.has(head))
    )
      return
    const routes = this.solver.state.unroutedRoutes.slice(
      0,
      this.workerCount * 4,
    )
    for (const slot of this.slots) {
      if (slot.busy) continue
      const route = routes.find(
        (routeId) =>
          !this.jobs.has(routeId) &&
          !this.committing.has(routeId) &&
          this.canSearch(routeId),
      )
      if (route === undefined) break
      slot.busy = true
      slot.input.control[1] = route
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
        job.done = true
        slot.busy = false
        this.schedule()
        return result
      })
      // Store rejected speculative jobs until consumption without allowing an
      // unhandled rejection to hide an eventual worker failure.
      void promise.catch((error: unknown) => {
        this.failure = { error }
      })
      slot.active = promise
      job = { slot, promise, done: false, generation: this.graph.generation }
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
    const waitStart = performance.now()
    const pendingRoutes = new Set(this.solver.state.unroutedRoutes)
    for (const [route, job] of this.jobs) {
      if (
        pendingRoutes.has(route) &&
        this.canSearch(route) &&
        (job.done || job.generation === this.graph.generation)
      )
        continue
      if (!job.done) Atomics.store(job.slot.input.control, 9, 1)
      if (job.generation !== this.graph.generation) this.staleSearches++
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
      for (let index = 0; valid && index < dependencies.length; index += 2)
        valid =
          dependencies[index + 1] ===
          Atomics.load(this.graph.context.headers, dependencies[index]! * 8)
      if (
        !valid &&
        result.status === "found" &&
        job.generation === this.graph.generation &&
        result.candidate
      ) {
        const candidate = this.certifyPath(routeId, result)
        if (candidate) {
          result.candidate = candidate
          valid = true
          this.certifiedSearches++
        }
      }
      if (
        !valid &&
        result.status === "exhausted" &&
        job.generation === this.graph.generation
      )
        valid = true
      if (!valid) {
        this.staleSearches++
        continue
      }
      this.committing.add(routeId)
      this.acceptedSearches++
      this.acceptedExpansions += result.iterations
      this.waitForRouteMs += performance.now() - waitStart
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

  private certifyPath(
    route: number,
    result: RouteSearchResult,
  ): Candidate | undefined {
    const candidate = result.candidate!
    if (
      this.solver.TRACE_DENSITY_COST_FACTOR < 0 ||
      this.solver.DISTANCE_TO_COST < 0 ||
      this.solver.problem.portPenalty?.some((cost) => cost < 0)
    )
      return undefined
    const path: Candidate[] = []
    for (
      let node: Candidate | undefined = candidate;
      node;
      node = node.prevCandidate
    )
      path.unshift(node)
    const net = this.solver.problem.routeNet[route]!
    for (const node of path) {
      const assigned = this.solver.state.portAssignment[node.portId]
      if (assigned !== -1 && assigned !== net) return undefined
    }
    const previousNet = this.solver.state.currentRouteNetId
    this.solver.state.currentRouteNetId = net
    try {
      let updated: Candidate = { ...path[0]!, prevCandidate: undefined }
      for (let i = 1; i < path.length; i++) {
        const node = path[i]!,
          g = this.solver.computeG(updated, node.portId)
        if (!Number.isFinite(g)) return undefined
        updated = { ...node, g, f: g + node.h, prevCandidate: updated }
      }
      if (updated.g === candidate.g) return updated
      const regions = result.terminalRegions!,
        costs = result.terminalCosts!
      if (!regions?.length || regions.length !== costs?.length)
        throw new Error("Route certificate is missing terminal bounds")
      // Every path traverses the chosen source region and at least one goal
      // region. The zero-length transition isolates each region's uniform
      // marginal cost; other increases from crossings and vias are nonnegative.
      const deltas: number[] = []
      for (let i = 0; i < regions.length; i++) {
        const port =
          i === 0
            ? this.solver.problem.routeStartPort[route]!
            : this.solver.problem.routeEndPort[route]!
        const current =
          this.solver.computeG(
            { portId: port, nextRegionId: regions[i]!, g: 0, h: 0, f: 0 },
            port,
          ) - (this.solver.problem.portPenalty?.[port] ?? 0)
        deltas.push(current - costs[i]!)
      }
      let unavoidable = deltas[0]!
      const goalRegions =
        this.solver.topology.incidentPortRegion[
          this.solver.problem.routeEndPort[route]!
        ]!
      if (!goalRegions.includes(regions[0]!) && deltas.length < 2)
        throw new Error("Route certificate has no reachable goal region")
      if (!goalRegions.includes(regions[0]!))
        unavoidable += Math.min(...deltas.slice(1))
      if (!Number.isFinite(unavoidable)) return undefined
      return updated.g - candidate.g <= unavoidable + 1e-9 ? updated : undefined
    } finally {
      this.solver.state.currentRouteNetId = previousNet
    }
  }
  get searchMs(): number {
    return this.waitForRouteMs + this.graphSyncMs
  }
  get maximumParticipatingWorkers(): number {
    return this.participatingSlots.size
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
