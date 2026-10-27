import {
  getTinyHyperGraphSolverOptions,
  type Candidate,
  type TinyHyperGraphSolver,
} from "../core"
import {
  DistributedSearchTask,
  SEARCH_CONTROL as C,
  type DistributedSearchInput,
} from "./DistributedSearchTask"
import { SharedRouteGraph } from "./SharedRouteGraph"

export interface ParallelSearchExecutor {
  persistentWorkerCount?: number
  executeAsync(
    Task: typeof DistributedSearchTask,
    input: DistributedSearchInput,
  ): Promise<unknown>
}

/** One exclusive owner per hop, with frozen graph data for the duration of a route. */
export class DistributedSearchPool {
  readonly workerCount: number
  searches = 0
  searchMs = 0
  maximumParticipatingWorkers = 0
  private readonly graph: SharedRouteGraph
  private readonly control = new Int32Array(new SharedArrayBuffer(12 * 4))
  private readonly published: Float64Array
  private readonly settled: Uint8Array
  private readonly parents: Int32Array
  private readonly bounds: Float64Array
  private readonly work: Int32Array
  private readonly messageCounts: Int32Array
  private readonly messageIds: Int32Array
  private readonly messageCosts: Float64Array
  private readonly counters: Float64Array
  private readonly stride: number
  private readonly capacity: number
  private readonly batchSize: number
  private readonly signature: string
  private readonly completions: Array<Promise<unknown>> = []
  private failure?: { error: unknown }

  constructor(
    private solver: TinyHyperGraphSolver,
    private readonly executor: ParallelSearchExecutor,
  ) {
    const count = executor.persistentWorkerCount
    if (count !== 1 && count !== 4)
      throw new Error("Parallel search requires one or four verified workers")
    this.workerCount = count
    this.signature = this.getSignature(solver)
    this.graph = new SharedRouteGraph(solver)
    this.stride = solver.topology.incidentPortRegion.reduce(
      (max, regions) => Math.max(max, regions.length),
      1,
    )
    const hops = solver.topology.portCount * this.stride
    const degree = solver.topology.regionIncidentPorts.reduce(
      (max, ports) => Math.max(max, ports.length),
      0,
    )
    this.batchSize = Math.max(
      1,
      Math.min(
        32,
        Math.floor((128 * 1024 * 1024) / (count * count * (degree + 2) * 24)),
      ),
    )
    this.capacity = this.batchSize * (degree + 2)
    this.published = new Float64Array(new SharedArrayBuffer(hops * 8))
    this.settled = new Uint8Array(new SharedArrayBuffer(hops))
    this.parents = new Int32Array(new SharedArrayBuffer(hops * 4))
    this.bounds = new Float64Array(new SharedArrayBuffer((count + 1) * 8))
    this.work = new Int32Array(new SharedArrayBuffer(count * 4))
    this.messageCounts = new Int32Array(
      new SharedArrayBuffer(count * count * 4),
    )
    this.messageIds = new Int32Array(
      new SharedArrayBuffer(count * count * this.capacity * 2 * 4),
    )
    this.messageCosts = new Float64Array(
      new SharedArrayBuffer(count * count * this.capacity * 2 * 8),
    )
    this.counters = new Float64Array(new SharedArrayBuffer(count * 4 * 8))
  }
  private getSignature(solver: TinyHyperGraphSolver): string {
    return JSON.stringify(getTinyHyperGraphSolverOptions(solver))
  }
  canReuse(solver: TinyHyperGraphSolver): boolean {
    return (
      this.solver.topology === solver.topology &&
      this.solver.problem === solver.problem &&
      this.signature === this.getSignature(solver)
    )
  }
  rebind(solver: TinyHyperGraphSolver): void {
    if (!this.canReuse(solver))
      throw new Error("Cannot rebind a different distributed search")
    this.solver = solver
    this.graph.rebind(solver)
  }
  async start(): Promise<void> {
    for (let owner = 0; owner < this.workerCount; owner++) {
      this.completions.push(
        this.executor
          .executeAsync(DistributedSearchTask, {
            topology: this.solver.topology,
            problem: this.solver.problem,
            options: getTinyHyperGraphSolverOptions(this.solver),
            context: this.graph.context,
            control: this.control,
            published: this.published,
            settled: this.settled,
            parents: this.parents,
            bounds: this.bounds,
            work: this.work,
            messageCounts: this.messageCounts,
            messageIds: this.messageIds,
            messageCosts: this.messageCosts,
            counters: this.counters,
            owner,
            workers: this.workerCount,
            capacity: this.capacity,
            batchSize: this.batchSize,
          })
          .catch((error) => {
            this.failure ??= { error }
            Atomics.store(this.control, C.error, 1)
            Atomics.store(this.control, C.stop, 1)
            for (const index of [C.ready, C.done, C.barrierEpoch, C.query])
              Atomics.notify(this.control, index)
          }),
      )
    }
    await this.waitFor(C.ready, this.workerCount)
  }
  private async waitFor(index: number, target: number): Promise<void> {
    while (Atomics.load(this.control, index) !== target) {
      if (this.failure) throw this.failure.error
      if (Atomics.load(this.control, C.error)) {
        await Promise.all(this.completions)
        throw (
          (this.failure as { error: unknown } | undefined)?.error ??
          new Error("Distributed search worker failed")
        )
      }
      const value = Atomics.load(this.control, index)
      if (value === target) break
      await Atomics.waitAsync(this.control, index, value, 100).value
    }
    if (this.failure) throw this.failure.error
  }
  async search(
    route: number,
    budget: number,
  ): Promise<{
    status: "found" | "exhausted" | "budget"
    candidate?: Candidate
    iterations: number
  }> {
    if (!Number.isInteger(budget) || budget < 1 || budget > 0x7fffffff)
      throw new Error(
        "Distributed search requires a finite positive iteration budget",
      )
    const start = performance.now(),
      previous = Array.from(this.counters)
    this.graph.sync()
    this.published.fill(Infinity)
    this.settled.fill(0)
    this.parents.fill(-1)
    this.bounds.fill(Infinity)
    this.work.fill(0)
    this.messageCounts.fill(0)
    for (const index of [
      C.done,
      C.tokens,
      C.result,
      C.barrierCount,
      C.barrierEpoch,
    ])
      this.control[index] = 0
    this.control[C.goal] = -1
    this.control[C.route] = route
    this.control[C.budget] = budget
    Atomics.add(this.control, C.query, 1)
    Atomics.notify(this.control, C.query)
    await this.waitFor(C.done, this.workerCount)
    this.searches++
    this.searchMs += performance.now() - start
    let participants = 0
    for (let owner = 0; owner < this.workerCount; owner++)
      if (this.counters[owner * 4]! > previous[owner * 4]!) participants++
    this.maximumParticipatingWorkers = Math.max(
      this.maximumParticipatingWorkers,
      participants,
    )
    const result = this.control[C.result]!,
      tokens = this.control[C.tokens]!
    if (result === 3) return { status: "budget", iterations: budget }
    if (result === 2) return { status: "exhausted", iterations: tokens + 1 }
    if (result !== 1) throw new Error("Invalid distributed search result")
    const path: number[] = [],
      seen = new Set<number>()
    for (
      let hop = this.control[C.goal]!;
      hop !== -1;
      hop = this.parents[hop]!
    ) {
      if (hop < 0 || hop >= this.parents.length || seen.has(hop))
        throw new Error("Invalid distributed search predecessor chain")
      path.push(hop)
      seen.add(hop)
    }
    let candidate: Candidate | undefined
    for (let i = path.length - 1; i >= 0; i--) {
      const hop = path[i]!,
        port = Math.floor(hop / this.stride)
      const region =
        this.solver.topology.incidentPortRegion[port]![hop % this.stride]!
      candidate = {
        hopId: hop,
        portId: port,
        nextRegionId: region,
        prevRegionId: candidate?.nextRegionId,
        g: this.published[hop]!,
        h: 0,
        f: this.published[hop]!,
        prevCandidate: candidate,
      }
    }
    if (
      !candidate ||
      candidate.portId !== this.solver.problem.routeEndPort[route]
    )
      throw new Error("Distributed search omitted the goal")
    return { status: "found", candidate, iterations: tokens + 1 }
  }
  get totals(): {
    expansions: number
    messages: number
    relaxations: number
    batches: number
  } {
    let expansions = 0,
      messages = 0,
      relaxations = 0,
      batches = 0
    for (let owner = 0; owner < this.workerCount; owner++) {
      expansions += this.counters[owner * 4]!
      messages += this.counters[owner * 4 + 1]!
      relaxations += this.counters[owner * 4 + 2]!
      batches += this.counters[owner * 4 + 3]!
    }
    return { expansions, messages, relaxations, batches }
  }
  async dispose(): Promise<void> {
    Atomics.store(this.control, C.stop, 1)
    Atomics.add(this.control, C.query, 1)
    Atomics.notify(this.control, C.query)
    Atomics.notify(this.control, C.barrierEpoch)
    await Promise.all(this.completions)
    if (this.failure) throw this.failure.error
  }
}
