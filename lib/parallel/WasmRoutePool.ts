import { createOwnerSearchMailbox, configureNativeOwnerGraph, prepareOwnerSearch, readOwnerSearch, OwnerSearchRunner, type OwnerSearchMailbox } from "./OwnerSearchMailbox"
import { findOwnerPathInWasm, type OwnerGeometry } from "./findOwnerPathInWasm"
import type { DistinctOwnerBlockerSearchOptions, DistinctOwnerBlockerSearchResult } from "../find-distinct-owner-blocker-path"
import type { Candidate, TinyHyperGraphSolver } from "../core"
import { SharedRouteGraph } from "./SharedRouteGraph"
import { kernelFields } from "./wasm/layout"
import { routeKernelBytes } from "./wasm/kernelBytes"
import { WasmRouteTask, type WasmRouteInput, type KernelExports } from "./WasmRouteTask"
export interface WasmRouteExecutor {
  persistentWorkerCount?: number
  executeAsync(Task: typeof WasmRouteTask, input: WasmRouteInput): Promise<unknown>
}
let compiledRouteModule: WebAssembly.Module | undefined
type Name = typeof kernelFields[number]
export class WasmRoutePool {
  readonly memory: WebAssembly.Memory
  private readonly ownerMailbox: OwnerSearchMailbox
  private readonly ownerRunner: OwnerSearchRunner
  ownerSearches = 0
  ownerSearchMs = 0
  ownerGraphRows = 0
  regionCostTables = 0
  parallelPortMasks = 0
  parallelConnectivityChecks = 0
  parallelConnectivitySavedExpansions = 0
  private readonly graph: SharedRouteGraph
  private readonly exports: KernelExports
  private readonly config: number
  private readonly stacks: number[] = []
  private readonly ints = new Map<Name, Int32Array>()
  private readonly doubles = new Map<Name, Float64Array>()
  private workers: Array<Promise<unknown>> = []
  private failure?: { error: unknown }
  readonly threads: number
  waves = 0
  timings = { syncMs: 0, prepareMs: 0, workMs: 0 }
  constructor(private solver: TinyHyperGraphSolver, private readonly executor: WasmRouteExecutor, private readonly delta = 1) {
    this.threads = executor.persistentWorkerCount ?? 0
    if (this.threads !== 1 && this.threads !== 4) throw new Error("Wasm routing requires one or four verified native workers")
    this.ownerMailbox = createOwnerSearchMailbox(solver.topology)
    configureNativeOwnerGraph(this.ownerMailbox, solver)
    this.ownerMailbox.config[19] = this.threads > 1 ? 1 : 0
    this.ownerRunner = new OwnerSearchRunner(this.ownerMailbox, 0)
    const module = compiledRouteModule ??= new WebAssembly.Module(routeKernelBytes)
    const temporary = new WebAssembly.Instance(module, { env: { memory: new WebAssembly.Memory({ initial: 32, maximum: 16384, shared: true }), owner_job: () => { throw new Error("Owner jobs run on helpers") } } }).exports as KernelExports
    let offset = Number(temporary.__heap_base.value)
    this.config = offset; offset += kernelFields.length * 4; offset = Math.ceil(offset / 8) * 8
    for (let n = 0; n < this.threads; n++) { offset += 262144; this.stacks.push(offset) }
    const allocations: Array<{ name: Name; offset: number; length: number; float: boolean }> = []
    const allocate = (name: Name, length: number, float = false): void => {
      offset = Math.ceil(offset / 8) * 8; allocations.push({ name, offset, length, float }); offset += length * (float ? 8 : 4)
    }
    const t = solver.topology, p = solver.problem, P = t.portCount, R = t.regionCount, S = Math.max(1, ...t.incidentPortRegion.map((r) => r.length)), H = P * S
    const Q = H + 1, A = t.regionIncidentPorts.reduce((sum, ports) => sum + ports.length, 0)
    if (t.incidentPortRegion.some((regions) => regions.length > 2)) throw new Error("Wasm routing supports at most two incident regions per port")
    const maskCapacity = Math.max(1024, A * 128), layers = Math.max(1, ...t.portZ) + 1
    const storageWords = Math.max(1024, P * 64) * 4
    const integerLengths: Partial<Record<Name, number>> = { CONTROL: 16, CHECK_SEEN: H, CHECK_QUEUE: H, CHECK_REGION: R * 3, CHECK_CONTROL: 8, ROOT_STATE: 5, 
      PARENT: H, SETTLED: H, HEAP: Q, POS: H,
      FRONTIER_NEXT: A, FRONTIER_HEAD: R, FRONTIER_GEN: R, R_OFF: R + 1, R_PORT: A, ADJ_HOP: A,
      P_Z: P, P_A1: P, P_A2: P, P_R1: P, P_R2: P, R_MASK: R, R_NET: R, ROUTE_START: p.routeCount, ROUTE_END: p.routeCount, ROUTE_NET: p.routeCount,
      P_MASK: P, ASSIGN: P, HEADERS: R * 8, STORAGE: storageWords, ITERATIONS: 4, P_RESERVED: P, WORK: 8, MASK_META: R * 4, MASK_GEN: A, MASK_DATA: maskCapacity, HOP_ADJ: H, LUT_META: R * 4, LUT_DIRTY: R, }
    const doubleLengths: Partial<Record<Name, number>> = { COST: H, F_COST: H, LUT_DATA: P * 32 + R * 16, HEURISTIC: P, P_X: P, P_Y: P,
      R_WIDTH: R, R_HEIGHT: R, PENALTY: P, CONGESTION: R, CACHE_COST: R, OPTIONS: 3, }
    for (const [name, n] of Object.entries(integerLengths)) allocate(name as Name, n!)
    for (const [name, n] of Object.entries(doubleLengths)) allocate(name as Name, n!, true)
    this.memory = new WebAssembly.Memory({ initial: Math.ceil(offset / 65536), maximum: 16384, shared: true })
    this.exports = new WebAssembly.Instance(module, { env: { memory: this.memory, owner_job: () => { throw new Error("Owner jobs run on helpers") } } }).exports as KernelExports
    const config = new Int32Array(this.memory.buffer, this.config, kernelFields.length)
    const safeConnectivity = [solver.DISTANCE_TO_COST, solver.minViaPadDiameter, solver.TRACE_DENSITY_COST_FACTOR].every((v) => Number.isFinite(v) && v >= 0 && v <= 1e6) &&
      t.regionWidth.every((width, r) => { const area = width * t.regionHeight[r]!; return Number.isFinite(area) && area >= 1e-100 && area <= 1e100 }) &&
      t.portX.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e100) && t.portY.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e100) &&
      (!p.portPenalty || p.portPenalty.every((v) => v === Infinity || (Number.isFinite(v) && v >= 0 && v <= 1e150)))
    for (const [name, value] of Object.entries({ P, R, S, THREADS: this.threads, QCAP: Q, MASK_CAP: maskCapacity, LAYERS: layers, LUT_CAP: P * 32 + R * 16, CHECK_ENABLED: Number(safeConnectivity), })) config[kernelFields.indexOf(name as Name)] = value
    for (const entry of allocations) {
      config[kernelFields.indexOf(entry.name)] = entry.offset
      if (entry.float) this.doubles.set(entry.name, new Float64Array(this.memory.buffer, entry.offset, entry.length))
      else this.ints.set(entry.name, new Int32Array(this.memory.buffer, entry.offset, entry.length))
    }
    this.graph = new SharedRouteGraph(solver, {
      headers: this.ints.get("HEADERS")!, storage: this.ints.get("STORAGE")!,
      costs: this.doubles.get("CACHE_COST")!, assignment: this.ints.get("ASSIGN")!,
      congestion: this.doubles.get("CONGESTION")!, epoch: new Int32Array(new SharedArrayBuffer(4)),
    })
    for (const [name, value] of Object.entries({ P_X: t.portX, P_Y: t.portY, R_WIDTH: t.regionWidth, R_HEIGHT: t.regionHeight,
      PENALTY: p.portPenalty ?? new Float64Array(P), OPTIONS: [solver.DISTANCE_TO_COST, solver.minViaPadDiameter, solver.TRACE_DENSITY_COST_FACTOR] })) this.doubles.get(name as Name)!.set(value)
    for (const [name, value] of Object.entries({ P_Z: t.portZ, P_A1: t.portAngleForRegion1, P_A2: t.portAngleForRegion2 ?? t.portAngleForRegion1,
      R_MASK: t.regionAvailableZMask ?? new Int32Array(R), R_NET: p.regionNetId, ROUTE_START: p.routeStartPort, ROUTE_END: p.routeEndPort,
      ROUTE_NET: p.routeNet, P_MASK: p.portSectionMask, P_RESERVED: solver.problemSetup.portEndpointReservationNetId })) this.ints.get(name as Name)!.set(value)
    this.ints.get("P_R1")!.set(t.incidentPortRegion.map((r) => r[0] ?? -1)); this.ints.get("P_R2")!.set(t.incidentPortRegion.map((r) => r[1] ?? -1))
    const offsets = this.ints.get("R_OFF")!, ports = this.ints.get("R_PORT")!, adjacency = this.ints.get("ADJ_HOP")!
    let n = 0
    for (let r = 0; r < R; r++) {
      offsets[r] = n
      for (const port of t.regionIncidentPorts[r]) {
        ports[n] = port
        this.ints.get("HOP_ADJ")![solver.getHopId(port, r)] = n
        const next = t.incidentPortRegion[port][0] === r ? t.incidentPortRegion[port][1] : t.incidentPortRegion[port][0]
        adjacency[n++] = next === undefined ? -1 : solver.getHopId(port, next)
      }
    }
    offsets[R] = n
    this.ints.get("MASK_GEN")!.fill(-1)
    this.ints.get("WORK")![7] = 1
  }
  get geometryPairsByWorker(): number[] {
    return Array.from({ length: 4 }, (_, worker) => Atomics.load(this.ownerMailbox.config, 20 + worker))
  }
  canReuse(solver: TinyHyperGraphSolver): boolean {
    return solver.topology === this.solver.topology && solver.problem === this.solver.problem &&
      solver.DISTANCE_TO_COST === this.solver.DISTANCE_TO_COST && solver.minViaPadDiameter === this.solver.minViaPadDiameter &&
      solver.TRACE_DENSITY_COST_FACTOR === this.solver.TRACE_DENSITY_COST_FACTOR
  }
  rebind(solver: TinyHyperGraphSolver): void {
    if (!this.canReuse(solver)) throw new Error("Cannot reuse a different Wasm route model")
    this.graph.rebind(solver); this.solver = solver
  }
  private async wait(index: number, target: number): Promise<void> {
    const control = this.ints.get("CONTROL")!
    for (;;) {
      if (this.failure) throw this.failure.error
      if (Atomics.load(control, 1)) throw new Error(`Wasm route worker invariant ${control[1]}`)
      const seen = Atomics.load(control, index)
      if (seen === target) return
      if (index === 2) {
        if (Atomics.wait(control, index, seen, 100) === "timed-out") await new Promise((resolve) => setTimeout(resolve, 0))
      } else {
        const result = Atomics.waitAsync(control, index, seen)
        if (result.async) await result.value
      }
    }
  }
  async start(): Promise<void> {
    const control = this.ints.get("CONTROL")!
    this.workers = Array.from({ length: this.threads - 1 }, (_, index) => {
      const owner = index + 1
      return this.executor.executeAsync(WasmRouteTask,
        { memory: this.memory, config: this.config, owner, stack: this.stacks[owner], ownerMailbox: this.ownerMailbox }).catch((error: unknown) => {
          this.failure = { error }; Atomics.store(control, 1, -1); Atomics.notify(control, 8); Atomics.notify(control, 2)
        })
    })
    if (this.threads > 1) {
      const config = this.ownerMailbox.config
      while (Atomics.load(config, 24) < this.threads - 1) {
        if (this.failure) throw this.failure.error
        const seen = Atomics.load(config, 24)
        if (seen >= this.threads - 1) break
        const result = Atomics.waitAsync(config, 24, seen, 100)
        if (result.async) await result.value
      }
    }
    if (this.threads > 1) await this.wait(8, this.threads - 1)
  }

  async search(routeId: number, budget: number): Promise<{ candidate?: Candidate; iterations: number; status: "found" | "exhausted" | "budget" }> {
    const t = this.solver.topology, p = this.solver.problem, control = this.ints.get("CONTROL")!
    const begin = performance.now()
    this.graph.sync()
    const beforePrepare = performance.now()
    this.exports.prepare(this.config, routeId, budget, this.delta)
    const beforeWork = performance.now()
    const costs = this.doubles.get("COST")!, stride = costs.length / t.portCount
    const target = p.routeEndPort[routeId]
    if (this.threads === 1) this.exports.single(this.config)
    else {
      const check = this.ints.get("CHECK_CONTROL")!
      let chunk = 2048, requested = false, checking = false
      while (!this.exports.advance(this.config, chunk)) {
        if (!requested) { requested = true; checking = this.exports.requestConnectivity(this.config) === 1 }
        if (checking) {
          const status = Atomics.load(check, 1)
          if (status === 2) { this.exports.applyConnectivity(this.config); break }
          if (status !== 0) checking = false
        }
        chunk = checking ? 256 : budget
      }
      this.exports.finishRoute(this.config)
    }
    this.regionCostTables += control[13]
    this.parallelPortMasks += control[5]
    this.parallelConnectivityChecks += control[9]
    this.parallelConnectivitySavedExpansions += Math.max(0, this.ints.get("CHECK_CONTROL")![6]!)
    if (control[1]) throw new Error(`Wasm route worker invariant ${control[1]}`)
    this.waves = 1
    let goal = control[11], cost = goal >= 0 ? costs[goal] : Infinity
    this.timings = { syncMs: beforePrepare - begin, prepareMs: beforeWork - beforePrepare, workMs: performance.now() - beforeWork }
    const iterations = Math.max(1, this.ints.get("ITERATIONS")!.subarray(0, this.threads).reduce((a, b) => a + b, 0))
    if (goal >= 0 && control[10] === 1) {
      const parents = this.ints.get("PARENT")!, path: number[] = [], visited = new Set<number>()
      for (let node = goal; node !== -1; node = parents[node]) {
        if (visited.has(node)) throw new Error("Wasm route predecessor cycle")
        visited.add(node); path.push(node)
      }
      path.reverse()
      if (Math.floor(path[0] / stride) !== p.routeStartPort[routeId]) throw new Error("Wasm route has the wrong source")
      let candidate: Candidate | undefined
      for (const hop of path) {
        const port = Math.floor(hop / stride), nextRegion = t.incidentPortRegion[port][hop % stride]
        candidate = { hopId: hop, portId: port, nextRegionId: nextRegion, prevRegionId: candidate?.nextRegionId,
          prevCandidate: candidate, g: costs[hop], h: 0, f: costs[hop] }
      }
      return { candidate, iterations, status: "found" }
    }
    return { iterations: control[6] <= 0 ? budget : iterations + 1, status: control[6] <= 0 ? "budget" : "exhausted" }
  }
  searchOwners<TState extends { portId: number; nextRegionId: number }, TOwner extends number, TData>(options: DistinctOwnerBlockerSearchOptions<TState, number, TOwner, TData>, geometry: OwnerGeometry<TState, TOwner, TData>, forbidden: ReadonlySet<number>): DistinctOwnerBlockerSearchResult<TState, TOwner, TData> {
    const start = performance.now()
    try {
      const mailbox = this.ownerMailbox, work = this.ints.get("WORK")!, control = this.ints.get("CONTROL")!
    const disconnected = prepareOwnerSearch(mailbox, this.solver.topology, options, geometry)
    if (disconnected) return disconnected
    if (this.threads === 1) return readOwnerSearch(mailbox, this.ownerRunner.run(), options, geometry)
    this.ownerSearches++
    Atomics.add(work, 4, 1); Atomics.add(work, 0, 1); Atomics.notify(work, 0)
    const results = [readOwnerSearch(mailbox, this.ownerRunner.run(), options, geometry)]
    for (let owner = 1; owner < 4; owner++) {
      let size: number
      while ((size = Atomics.load(mailbox.signal, owner)) === 0) {
        if (Atomics.load(control, 1)) throw new Error("Owner search worker failed")
        Atomics.wait(mailbox.signal, owner, 0, 100)
      }
      if (size < 0) throw new Error("Owner search worker failed")
      results.push(readOwnerSearch(mailbox, size, options, geometry))
    }
    const graph = new Int32Array(mailbox.memory.buffer, mailbox.config[10]!, 16)
    this.ownerGraphRows += graph[13]! + graph[14]! + graph[15]!
    return results[0]!
    } finally { this.ownerSearchMs += performance.now() - start }
  }

  async dispose(): Promise<void> {
    const control = this.ints.get("CONTROL")!
    Atomics.store(control, 7, 1)
    const work = this.ints.get("WORK")!
    Atomics.add(work, 0, 1); Atomics.notify(work, 0)
    await Promise.all(this.workers)
    if (this.failure) throw this.failure.error
  }
}
