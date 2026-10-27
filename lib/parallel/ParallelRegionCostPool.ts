import {
  getTinyHyperGraphSolverOptions,
  type Candidate,
  type TinyHyperGraphSolver,
} from "../core"
import { RegionCostTask, type RegionCostInput } from "./RegionCostTask"
import { SharedRouteGraph } from "./SharedRouteGraph"

export interface ParallelCostExecutor {
  persistentWorkerCount?: number
  executeAsync(
    Task: typeof RegionCostTask,
    input: RegionCostInput,
  ): Promise<unknown>
}

/** Workers prepare independent region tables; the original A* stays on the caller. */
export class ParallelRegionCostPool {
  readonly workerCount: number
  prepareMs = 0
  cacheHits = 0
  cacheMisses = 0
  maximumParticipatingWorkers = 0
  private readonly graph: SharedRouteGraph
  private readonly control = new Int32Array(new SharedArrayBuffer(8 * 4))
  private readonly jobs: Int32Array
  private readonly offsets: Int32Array
  private readonly values: Float64Array
  private readonly counters: Float64Array
  private readonly versions: Int32Array
  private readonly caches: TinyHyperGraphSolver["state"]["regionIntersectionCaches"] =
    []
  private readonly owned: Int32Array
  private readonly preparedOwned: Uint8Array
  private readonly preparedNets: Int32Array
  private activeNet?: number
  private readonly portIndex: Int32Array
  private readonly stride: number
  private readonly completions: Array<Promise<unknown>> = []
  private failure?: { error: unknown }
  private signature: string

  constructor(
    private solver: TinyHyperGraphSolver,
    private readonly executor: ParallelCostExecutor,
  ) {
    const count = executor.persistentWorkerCount
    if (count !== 1 && count !== 4)
      throw new Error("Parallel costs require one or four verified workers")
    this.workerCount = count
    this.signature = this.getSignature(solver)
    this.graph = new SharedRouteGraph(solver)
    const { topology } = solver
    this.offsets = new Int32Array(
      new SharedArrayBuffer(topology.regionCount * 4),
    ).fill(-1)
    this.versions = new Int32Array(topology.regionCount).fill(-1)
    this.owned = new Int32Array(new SharedArrayBuffer(topology.regionCount * 4))
    this.preparedOwned = new Uint8Array(topology.regionCount)
    this.preparedNets = new Int32Array(topology.regionCount)
    this.stride = Math.max(
      1,
      ...topology.incidentPortRegion.map((regions) => regions.length),
    )
    this.portIndex = new Int32Array(topology.portCount * this.stride).fill(-1)
    let cells = 0
    let jobCapacity = 0
    // Allocate smaller regions first and cap the shared score arena at 256 MiB.
    // Dense regions are split into row chunks so all workers share their work.
    const regions = Array.from(
      { length: topology.regionCount },
      (_, region) => region,
    ).sort(
      (a, b) =>
        topology.regionIncidentPorts[a]!.length -
        topology.regionIncidentPorts[b]!.length,
    )
    for (const region of regions) {
      const ports = topology.regionIncidentPorts[region]!
      if (
        ports.length === 0 ||
        cells + ports.length * ports.length > 32 * 1024 * 1024
      )
        continue
      this.offsets[region] = cells
      cells += ports.length * ports.length
      jobCapacity += Math.ceil(ports.length / 16)
      for (let index = 0; index < ports.length; index++) {
        const port = ports[index]!
        const slot = topology.incidentPortRegion[port]!.indexOf(region)
        if (slot < 0)
          throw new Error("Region cost topology has a non-incident port")
        this.portIndex[port * this.stride + slot] = index
      }
    }
    this.jobs = new Int32Array(new SharedArrayBuffer(jobCapacity * 3 * 4))
    this.values = new Float64Array(new SharedArrayBuffer(cells * 8))
    this.counters = new Float64Array(new SharedArrayBuffer(count * 3 * 8))
  }

  private getSignature(solver: TinyHyperGraphSolver): string {
    return JSON.stringify({
      via: solver.minViaPadDiameter,
      density: solver.TRACE_DENSITY_COST_FACTOR,
    })
  }

  canReuse(solver: TinyHyperGraphSolver): boolean {
    return (
      solver.topology === this.solver.topology &&
      solver.problem === this.solver.problem &&
      this.getSignature(solver) === this.signature
    )
  }

  rebind(solver: TinyHyperGraphSolver): void {
    this.solver = solver
    this.graph.rebind(solver)
  }

  async start(): Promise<void> {
    for (let worker = 0; worker < this.workerCount; worker++) {
      const input: RegionCostInput = {
        topology: this.solver.topology,
        problem: this.solver.problem,
        options: getTinyHyperGraphSolverOptions(this.solver),
        context: this.graph.context,
        control: this.control,
        jobs: this.jobs,
        offsets: this.offsets,
        owned: this.owned,
        values: this.values,
        counters: this.counters,
        worker,
      }
      this.completions.push(
        this.executor
          .executeAsync(RegionCostTask, input)
          .catch((error: unknown) => {
            this.failure = { error }
            Atomics.store(this.control, 5, 1)
            Atomics.notify(this.control, 3)
            Atomics.notify(this.control, 6)
          }),
      )
    }
    await this.waitFor(6, this.workerCount)
  }

  private async waitFor(index: number, expected: number): Promise<void> {
    while (Atomics.load(this.control, index) < expected) {
      if (Atomics.load(this.control, 5))
        throw new Error("Region cost worker failed", {
          cause: this.failure?.error,
        })
      const value = Atomics.load(this.control, index)
      if (value >= expected) break
      const wait = Atomics.waitAsync(this.control, index, value, 100)
      if (wait.async) await wait.value
    }
    if (Atomics.load(this.control, 5))
      throw new Error("Region cost worker failed", {
        cause: this.failure?.error,
      })
  }

  async prepare(net: number): Promise<void> {
    const start = performance.now()
    this.graph.sync()
    this.activeNet = net
    const dirty: number[] = []
    let count = 0
    for (let region = 0; region < this.offsets.length; region++) {
      if (this.offsets[region] === -1) continue
      const version = Atomics.load(this.graph.context.headers, region * 8)
      const own = this.solver.state.regionIntersectionCaches[
        region
      ]!.netIds.includes(net)
        ? 1
        : 0
      if (
        version === this.versions[region] &&
        own === this.preparedOwned[region] &&
        (!own || this.preparedNets[region] === net)
      )
        continue
      this.owned[region] = own
      dirty.push(region)
      const degree = this.solver.topology.regionIncidentPorts[region]!.length
      for (let row = 0; row < degree; row += 16) {
        this.jobs[count * 3] = region
        this.jobs[count * 3 + 1] = row
        this.jobs[count * 3 + 2] = Math.min(degree, row + 16)
        count++
      }
    }
    if (count > 0) {
      const previous = Array.from(
        { length: this.workerCount },
        (_, worker) => this.counters[worker * 3 + 2]!,
      )
      this.control[1] = count
      this.control[7] = net
      Atomics.store(this.control, 2, this.workerCount)
      Atomics.store(this.control, 3, 0)
      Atomics.add(this.control, 0, 1)
      Atomics.notify(this.control, 0)
      await this.waitFor(3, this.workerCount)
      let participants = 0
      for (let worker = 0; worker < this.workerCount; worker++)
        if (this.counters[worker * 3 + 2]! > previous[worker]!) participants++
      this.maximumParticipatingWorkers = Math.max(
        this.maximumParticipatingWorkers,
        participants,
      )
      for (const region of dirty) {
        this.versions[region] = Atomics.load(
          this.graph.context.headers,
          region * 8,
        )
        this.caches[region] =
          this.solver.state.regionIntersectionCaches[region]!
        this.preparedOwned[region] = this.owned[region]!
        this.preparedNets[region] = net
      }
    }
    this.prepareMs += performance.now() - start
  }

  lookup(candidate: Candidate, neighbor: number): number | undefined {
    const region = candidate.nextRegionId
    const cache = this.solver.state.regionIntersectionCaches[region]!
    if (this.offsets[region] === -1 || this.caches[region] !== cache) {
      this.cacheMisses++
      return undefined
    }
    if (this.activeNet !== this.solver.state.currentRouteNetId) {
      this.cacheMisses++
      return undefined
    }
    const fromSlot =
      this.solver.topology.incidentPortRegion[candidate.portId]!.indexOf(region)
    const toSlot =
      this.solver.topology.incidentPortRegion[neighbor]!.indexOf(region)
    if (fromSlot < 0 || toSlot < 0)
      throw new Error("Region cost lookup uses a non-incident port")
    const from = this.portIndex[candidate.portId * this.stride + fromSlot]!
    const to = this.portIndex[neighbor * this.stride + toSlot]!
    const width = this.solver.topology.regionIncidentPorts[region]!.length
    this.cacheHits++
    return this.values[this.offsets[region]! + from * width + to]!
  }

  get totals(): { workerMs: number; tables: number; cells: number } {
    let workerMs = 0,
      tables = 0,
      cells = 0
    for (let worker = 0; worker < this.workerCount; worker++) {
      workerMs += this.counters[worker * 3]!
      tables += this.counters[worker * 3 + 1]!
      cells += this.counters[worker * 3 + 2]!
    }
    return { workerMs, tables, cells }
  }

  async dispose(): Promise<void> {
    Atomics.store(this.control, 4, 1)
    Atomics.add(this.control, 0, 1)
    Atomics.notify(this.control, 0)
    await Promise.all(this.completions)
    if (this.failure) throw this.failure.error
  }
}
