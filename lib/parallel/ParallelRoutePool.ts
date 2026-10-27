import { type Candidate, getTinyHyperGraphSolverOptions } from "../core"
import type { OutsideInPartialRipTinyHyperGraphSolver } from "../outside-in-partial-rip-tiny-hypergraph-solver"
import { RouteSearchTask, type RouteSearchInput } from "./RouteSearchTask"
import { SharedRouteGraph } from "./SharedRouteGraph"

export interface ParallelRouteExecutor {
  persistentWorkerCount?: number
  executeAsync(
    Task: typeof RouteSearchTask,
    input: RouteSearchInput,
  ): Promise<unknown>
}
export type RouteSearchResult = {
  status: "found" | "exhausted" | "budget" | "canceled"
  iterations: number
  candidate?: Candidate
  dependencies: Int32Array
}
type Slot = {
  input: RouteSearchInput
  completion: Promise<unknown>
  busy: boolean
  active?: Promise<RouteSearchResult>
  error?: unknown
}
type Job = { slot: Slot; promise: Promise<RouteSearchResult>; done: boolean }

/** Optimistic searches run concurrently; only the coordinator commits routes. */
export class ParallelRoutePool {
  readonly workerCount: number
  searches = 0
  acceptedSearches = 0
  staleSearches = 0
  speculativeExpansions = 0
  maximumConcurrentSearches = 0
  private readonly graph: SharedRouteGraph
  private readonly slots: Slot[] = []
  private readonly jobs = new Map<number, Job>()
  private readonly committing = new Set<number>()
  private failure?: { error: unknown }
  private disposed = false
  private budget = 0
  private readonly signature: string

  constructor(
    private solver: OutsideInPartialRipTinyHyperGraphSolver,
    private readonly executor: ParallelRouteExecutor,
  ) {
    const count = executor.persistentWorkerCount
    if (count !== 1 && count !== 4)
      throw new Error("Parallel routing requires one or four verified workers")
    this.workerCount = count
    this.graph = new SharedRouteGraph(solver)
    this.signature = JSON.stringify(getTinyHyperGraphSolverOptions(solver))
  }

  canReuse(solver: OutsideInPartialRipTinyHyperGraphSolver): boolean {
    return (
      this.solver.topology === solver.topology &&
      this.solver.problem === solver.problem &&
      this.signature === JSON.stringify(getTinyHyperGraphSolverOptions(solver))
    )
  }

  rebind(solver: OutsideInPartialRipTinyHyperGraphSolver): void {
    this.cancelJobs()
    this.solver = solver
    this.graph.rebind(solver)
  }

  async start(): Promise<void> {
    const solver = this.solver
    const stride = Math.max(
      1,
      ...solver.topology.incidentPortRegion.map((regions) => regions.length),
    )
    const capacity = solver.topology.portCount * stride + 1
    for (let index = 0; index < this.workerCount; index++) {
      const input: RouteSearchInput = {
        topology: solver.topology,
        problem: solver.problem,
        options: getTinyHyperGraphSolverOptions(solver),
        context: this.graph.context,
        control: new Int32Array(new SharedArrayBuffer(10 * 4)),
        budget: new Float64Array(new SharedArrayBuffer(8)),
        pathIds: new Int32Array(new SharedArrayBuffer(capacity * 4 * 4)),
        pathCosts: new Float64Array(new SharedArrayBuffer(capacity * 3 * 8)),
        dependencies: new Int32Array(
          new SharedArrayBuffer(solver.topology.regionCount * 2 * 4),
        ),
      }
      const slot: Slot = { input, busy: false, completion: Promise.resolve() }
      this.slots.push(slot)
      slot.completion = this.executor
        .executeAsync(RouteSearchTask, input)
        .catch((error: unknown) => {
          slot.error = error
          Atomics.store(input.control, 0, -1)
          Atomics.notify(input.control, 0)
          Atomics.notify(input.control, 7)
        })
    }
    for (const slot of this.slots) {
      while (Atomics.load(slot.input.control, 7) !== 1) {
        if (Atomics.load(slot.input.control, 0) === -1)
          throw new Error("Route worker failed to start", { cause: slot.error })
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
    if (Atomics.load(control, 0) === -1)
      throw new Error("Route worker failed", { cause: slot.error })
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
      status: (["found", "exhausted", "budget", "canceled"] as const)[
        control[3]! - 1
      ]!,
      iterations: control[4]!,
      candidate,
      dependencies: dependencies.slice(0, control[6]! * 2),
    }
    this.speculativeExpansions += result.iterations
    Atomics.store(control, 0, 0)
    Atomics.notify(control, 0)
    return result
  }

  private schedule(): void {
    if (this.disposed || this.failure) return
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
          this.solver.canSearchRouteInParallel(routeId),
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
      job = { slot, promise, done: false }
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
    this.graph.sync()
    const pendingRoutes = new Set(this.solver.state.unroutedRoutes)
    for (const [route, job] of this.jobs) {
      if (
        pendingRoutes.has(route) &&
        this.solver.canSearchRouteInParallel(route)
      )
        continue
      if (!job.done) Atomics.store(job.slot.input.control, 9, 1)
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
      let valid = result.status !== "canceled"
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
      return result
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
