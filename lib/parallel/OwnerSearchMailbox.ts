import type { TinyHyperGraphTopology, TinyHyperGraphSolver } from "../core"
import type {
  DistinctOwnerBlockerSearchOptions,
  DistinctOwnerBlockerSearchResult,
} from "../find-distinct-owner-blocker-path"
import { findDisconnectedOwnerGraph } from "./findDisconnectedOwnerGraph"
import type { OwnerGeometry } from "./findOwnerPathInWasm"
import { ownerKernelSharedBytes } from "./wasm/ownerKernelSharedBytes"

export type OwnerSearchMailbox = {
  graphToken?: object
  memory: WebAssembly.Memory
  config: Int32Array
  signal: Int32Array
  stacks: number[]
  arenas: number[]
  arenaBytes: number
  graphStart: number
  graphEnd: number
}
type Exports = WebAssembly.Exports & {
  prepareNativeGraph(...args: number[]): void
  checkReachability(...args: number[]): number
  search(
    limit: number,
    start: number,
    stride: number,
    goal: number,
    bound: number,
    bases: number,
    locals: number,
    distances: number,
    arenaBegin: number,
    arenaEnd: number,
  ): number
  __heap_base: WebAssembly.Global
  __stack_pointer: WebAssembly.Global
}
let compiled: WebAssembly.Module | undefined
export class OwnerSearchRunner {
  readonly exports: Exports
  private top: number
  private geometryReady = false
  constructor(
    private readonly mailbox: OwnerSearchMailbox,
    private readonly owner: number,
  ) {
    compiled ??= new WebAssembly.Module(ownerKernelSharedBytes)
    this.top = mailbox.arenas[owner]!
    const config = mailbox.config,
      memory = mailbox.memory
    const x = new Float64Array(memory.buffer, config[4]!, config[8]!),
      y = new Float64Array(memory.buffer, config[5]!, config[8]!)
    let pointers: Int32Array | undefined
    this.exports = new WebAssembly.Instance(compiled, {
      env: {
        memory,
        allocate: (bytes: number): number => {
          const pointer = Math.ceil(this.top / 8) * 8
          this.top = pointer + bytes
          if (this.top > mailbox.arenas[owner]! + mailbox.arenaBytes)
            throw new Error("Owner label arena exhausted")
          return pointer
        },
        load_hops: (state: number): number => {
          if (
            !pointers ||
            pointers.byteOffset !== config[0] ||
            pointers.length !== config[9]
          )
            pointers = new Int32Array(memory.buffer, config[0]!, config[9]!)
          return pointers[state]!
        },
        is_goal: (): number => {
          throw new Error("Packed owner search requires geometry")
        },
        edge_distance: (a: number, b: number): number => {
          return Math.hypot(x[a]! - x[b]!, y[a]! - y[b]!)
        },
        invalid_distance: (overflow: number): never => {
          if (overflow === 2) throw new Error("Owner label arena exhausted")
          if (overflow === 3)
            throw new Error("Foreign port assignment has no committed owner")
          if (overflow === 4)
            throw new Error("Packed owner graph exceeds capacity")
          throw new Error(
            overflow
              ? "Distinct-owner blocker path distance overflowed"
              : "Distinct-owner blocker hops require finite distances >= 0",
          )
        },
      },
    }).exports as Exports
    this.exports.__stack_pointer.value = mailbox.stacks[owner]!
  }
  run(): number {
    if (!this.geometryReady) {
      buildOwnerGeometry(this.mailbox, this.owner)
      Atomics.add(this.mailbox.config, 25, 1)
      Atomics.notify(this.mailbox.config, 25)
      this.geometryReady = true
    }
    this.top = this.mailbox.arenas[this.owner]!
    const c = this.mailbox.config,
      limit = new Float64Array(c.buffer, c.byteOffset + 120, 1)[0]!
    if (c[7] === 1) {
      try {
        this.exports.prepareNativeGraph(
          c[6]!,
          c[0]!,
          c[14]!,
          c[15]!,
          c[12]!,
          c[1]!,
          c[2]!,
          c[10]!,
          this.mailbox.arenas[this.owner]!,
          this.mailbox.arenas[this.owner]! + this.mailbox.arenaBytes,
          this.owner,
        )
        if (
          Atomics.load(
            new Int32Array(this.mailbox.memory.buffer, c[10]!, 16),
            7,
          )
        )
          throw new Error("Owner graph worker failed")
      } catch (error) {
        const bound = new Int32Array(this.mailbox.memory.buffer, c[10]!, 16)
        Atomics.store(bound, 7, 1)
        Atomics.notify(bound, 11)
        throw error
      }
    }
    if (this.owner > 0) return 1
    const expected = c[19] === 1 ? 4 : 1
    while (Atomics.load(c, 25) < expected) {
      const seen = Atomics.load(c, 25)
      Atomics.wait(c, 25, seen, 100)
    }
    if (c[26] === 1) {
      const disconnected = this.exports.checkReachability(
        limit,
        c[3]!,
        c[1]!,
        c[2]!,
        c[0]!,
        c[6]!,
        c[11]!,
        c[12]!,
        c[13]!,
        this.mailbox.arenas[this.owner]!,
        this.mailbox.arenas[this.owner]! + this.mailbox.arenaBytes,
      )
      if (disconnected) return disconnected
    }
    return this.exports.search(
      limit,
      c[3]!,
      c[1]!,
      c[2]!,
      c[10]!,
      c[11]!,
      c[12]!,
      c[13]!,
      this.mailbox.arenas[this.owner]!,
      this.mailbox.arenas[this.owner]! + this.mailbox.arenaBytes,
    )
  }
}
export function createOwnerSearchMailbox(
  topology: TinyHyperGraphTopology,
): OwnerSearchMailbox {
  // Virtual memory is reserved up front; private arenas commit pages as labels grow.
  const memory = new WebAssembly.Memory({
    initial: 16384,
    maximum: 16384,
    shared: true,
  })
  const config = new Int32Array(new SharedArrayBuffer(128)),
    signal = new Int32Array(new SharedArrayBuffer(64))
  const stacks = [0, 1, 2, 3].map((owner) => 131072 * (owner + 2))
  const graphStart = 1048576,
    graphEnd = 256 * 1024 * 1024,
    arenaBytes = (1024 * 1024 * 1024 - graphEnd) / 4
  const arenas = [0, 1, 2, 3].map((owner) => graphEnd + owner * arenaBytes)
  const result = {
    memory,
    config,
    signal,
    stacks,
    arenas,
    arenaBytes,
    graphStart,
    graphEnd,
  }
  config[10] = graphStart - 64
  config[4] = graphStart
  config[5] = graphStart + topology.portCount * 8
  config[8] = topology.portCount
  new Float64Array(memory.buffer, config[4]!, topology.portCount).set(
    topology.portX,
  )
  new Float64Array(memory.buffer, config[5]!, topology.portCount).set(
    topology.portY,
  )
  const stride = Math.max(
      1,
      ...topology.incidentPortRegion.map((regions) => regions.length),
    ),
    hops = topology.portCount * stride
  config[11] = config[5]! + topology.portCount * 8
  config[12] = config[11]! + hops * 4
  config[13] = Math.ceil((config[12]! + hops * 4) / 8) * 8
  const entries = topology.regionIncidentPorts.reduce(
    (sum, ports) => sum + (ports.length * (ports.length - 1)) / 2,
    0,
  )
  result.graphStart = config[13]! + entries * 8
  if (result.graphStart > graphEnd)
    throw new Error("Owner geometry exceeds graph capacity")
  const bases = new Int32Array(memory.buffer, config[11]!, hops),
    locals = new Int32Array(memory.buffer, config[12]!, hops),
    distances = new Float64Array(memory.buffer, config[13]!, entries)
  config[14] = result.graphStart
  config[15] = config[14]! + (topology.regionIncidentPorts.length + 1) * 4
  config[16] =
    config[15]! +
    topology.regionIncidentPorts.reduce((sum, ports) => sum + ports.length, 0) *
      4
  config[17] = topology.regionIncidentPorts.length
  result.graphStart = Math.ceil((config[16]! + config[17]! * 4) / 8) * 8
  if (result.graphStart > graphEnd)
    throw new Error("Owner geometry metadata exceeds graph capacity")
  const offsets = new Int32Array(memory.buffer, config[14]!, config[17]! + 1),
    regionPorts = new Int32Array(
      memory.buffer,
      config[15]!,
      topology.regionIncidentPorts.reduce(
        (sum, ports) => sum + ports.length,
        0,
      ),
    ),
    regionBases = new Int32Array(memory.buffer, config[16]!, config[17]!)
  let base = 0,
    at = 0
  for (let region = 0; region < topology.regionIncidentPorts.length; region++) {
    const ports = topology.regionIncidentPorts[region]!
    offsets[region] = at
    regionPorts.set(ports, at)
    at += ports.length
    regionBases[region] = base
    for (let i = 0; i < ports.length; i++) {
      const port = ports[i]!,
        hop = port * stride + topology.incidentPortRegion[port]!.indexOf(region)
      bases[hop] = base
      locals[hop] = i
    }
    base += (ports.length * (ports.length - 1)) / 2
  }
  offsets[config[17]!] = at
  return result
}
/** Install immutable routing constraints once beside the shared geometry. */
export function configureNativeOwnerGraph(
  mailbox: OwnerSearchMailbox,
  solver: TinyHyperGraphSolver,
): void {
  const t = solver.topology,
    p = solver.problem,
    c = mailbox.config
  let top = mailbox.graphStart
  const allocate = (values: ArrayLike<number>): number => {
    const pointer = Math.ceil(top / 8) * 8
    top = pointer + values.length * 4
    if (top > mailbox.graphEnd)
      throw new Error("Native owner graph exceeds capacity")
    new Int32Array(mailbox.memory.buffer, pointer, values.length).set(values)
    return pointer
  }
  c[6] = allocate(new Int32Array(32))
  const config = new Int32Array(mailbox.memory.buffer, c[6]!, 32)
  config[0] = t.portCount
  config[1] = t.regionCount
  config[2] = Math.max(
    1,
    ...t.incidentPortRegion.map((regions) => regions.length),
  )
  for (const [index, values] of [
    [3, t.incidentPortRegion.map((regions) => regions[0] ?? -1)],
    [4, t.incidentPortRegion.map((regions) => regions[1] ?? -1)],
    [5, t.portAngleForRegion1],
    [6, t.portAngleForRegion2 ?? t.portAngleForRegion1],
    [7, t.portZ],
    [8, t.regionAvailableZMask ?? new Int32Array(t.regionCount)],
    [9, p.regionNetId],
    [10, p.routeNet],
    [11, solver.problemSetup.portEndpointReservationNetId],
    [12, p.portSectionMask],
    [13, new Int32Array(t.portCount)],
    [14, new Int32Array(p.routeCount)],
    [15, new Int32Array(t.portCount + 1)],
    [17, new Int32Array(t.regionCount + 1)],
  ] as Array<[number, ArrayLike<number>]>)
    config[index] = allocate(values)
  config[20] = p.routeCount
  mailbox.graphStart = Math.ceil(top / 8) * 8
}
/** Cooperating workers claim whole regions; every unordered port pair is computed once. */
export function buildOwnerGeometry(
  mailbox: OwnerSearchMailbox,
  owner: number,
): void {
  const c = mailbox.config,
    memory = mailbox.memory.buffer
  const x = new Float64Array(memory, c[4]!, c[8]!),
    y = new Float64Array(memory, c[5]!, c[8]!)
  const offsets = new Int32Array(memory, c[14]!, c[17]! + 1),
    ports = new Int32Array(memory, c[15]!, offsets[c[17]!]!),
    bases = new Int32Array(memory, c[16]!, c[17]!)
  const distances = new Float64Array(memory, c[13]!, (c[14]! - c[13]!) / 8)
  let pairs = 0
  for (;;) {
    const region = Atomics.add(c, 18, 1)
    if (region >= c[17]!) break
    const start = offsets[region]!,
      end = offsets[region + 1]!,
      base = bases[region]!
    for (let i = start; i < end; i++) {
      const a = ports[i]!,
        row = i - start
      for (let j = start; j < i; j++) {
        const b = ports[j]!
        distances[base + (row * (row - 1)) / 2 + j - start] = Math.hypot(
          x[a]! - x[b]!,
          y[a]! - y[b]!,
        )
        pairs++
      }
    }
  }
  Atomics.store(c, 20 + owner, pairs)
}
/** Pack adjacency once; each worker reads it and allocates labels in its own arena. */
export function prepareOwnerSearch<TState, TOwner extends number, TData>(
  mailbox: OwnerSearchMailbox,
  topology: TinyHyperGraphTopology,
  options: DistinctOwnerBlockerSearchOptions<TState, number, TOwner, TData>,
  geometry: OwnerGeometry<TState, TOwner, TData>,
): DistinctOwnerBlockerSearchResult<TState, TOwner, TData> | undefined {
  const limit = options.maxExpandedLabels ?? Infinity
  if (options.checkReachability && !geometry.nativeGraph) {
    const disconnected = findDisconnectedOwnerGraph(options, limit)
    if (disconnected) return disconnected
  }
  const input = geometry.nativeGraph,
    cachedConfig = mailbox.config
  if (input?.cacheToken && mailbox.graphToken === input.cacheToken) {
    const nativeConfig = new Int32Array(
      mailbox.memory.buffer,
      cachedConfig[6]!,
      32,
    )
    const forbidden = new Int32Array(
      mailbox.memory.buffer,
      nativeConfig[14]!,
      nativeConfig[20]!,
    )
    forbidden.fill(0)
    for (const owner of input.forbidden) forbidden[owner] = 1
    new Float64Array(cachedConfig.buffer, cachedConfig.byteOffset + 120, 1)[0] =
      limit
    const bound = new Int32Array(mailbox.memory.buffer, cachedConfig[10]!, 16)
    bound.fill(0, 12, 16)
    cachedConfig[7] = 2
    cachedConfig[26] = options.checkReachability ? 1 : 0
    mailbox.signal.fill(0)
    return undefined
  }
  mailbox.graphToken = input?.cacheToken
  let top = mailbox.graphStart
  const allocate = (bytes: number): number => {
    const pointer = Math.ceil(top / 8) * 8
    top = pointer + bytes
    if (top > mailbox.graphEnd)
      throw new Error("Packed owner graph exceeds capacity")
    return pointer
  }
  const c = mailbox.config,
    count = topology.portCount * geometry.stride
  c[0] = allocate(count * 4)
  c[1] = geometry.stride
  c[2] = geometry.goal
  c[3] = geometry.stateId(options.start)
  c[9] = count
  new Float64Array(c.buffer, c.byteOffset + 120, 1)[0] = limit
  const pointers = new Int32Array(mailbox.memory.buffer, c[0]!, count),
    data = new DataView(mailbox.memory.buffer)
  const bound = new Int32Array(mailbox.memory.buffer, c[10]!, 16)
  bound.fill(0)
  bound[0] = 2147483647
  bound[1] = 2147483647
  c[26] = geometry.nativeGraph && options.checkReachability ? 1 : 0
  if (geometry.nativeGraph) {
    if (!c[6]) throw new Error("Native owner graph is not configured")
    const input = geometry.nativeGraph,
      config = new Int32Array(mailbox.memory.buffer, c[6]!, 32)
    const assignment = new Int32Array(
      mailbox.memory.buffer,
      config[13]!,
      count / geometry.stride,
    )
    assignment.set(input.assignment)
    const forbidden = new Int32Array(
      mailbox.memory.buffer,
      config[14]!,
      config[20]!,
    )
    forbidden.fill(0)
    for (const owner of input.forbidden) forbidden[owner] = 1
    const ownerOffsets = new Int32Array(
        mailbox.memory.buffer,
        config[15]!,
        assignment.length + 1,
      ),
      owners: number[] = []
    for (let port = 0; port < assignment.length; port++) {
      ownerOffsets[port] = owners.length
      for (const owner of input.portOwners.get(port) ?? []) owners.push(owner)
    }
    ownerOffsets[assignment.length] = owners.length
    config[16] = allocate(owners.length * 4)
    new Int32Array(mailbox.memory.buffer, config[16]!, owners.length).set(
      owners,
    )
    const segmentOffsets = new Int32Array(
        mailbox.memory.buffer,
        config[17]!,
        input.segments.length + 1,
      ),
      segments: number[] = []
    for (let region = 0; region < input.segments.length; region++) {
      segmentOffsets[region] = segments.length / 3
      for (const segment of input.segments[region]!) segments.push(...segment)
    }
    segmentOffsets[input.segments.length] = segments.length / 3
    config[18] = allocate(segments.length * 4)
    new Int32Array(mailbox.memory.buffer, config[18]!, segments.length).set(
      segments,
    )
    config[19] = input.net
    c[7] = 1
    bound[2] = config[14]!
    bound[8] = Math.ceil(top / 8) * 8
    bound[9] = mailbox.graphEnd
    bound[10] = 0
    bound[11] = c[19] === 1 ? 4 : 1
  } else {
    c[7] = 0
    const encodedOwners = new WeakMap<readonly TOwner[], number>(),
      templates = new Map<number, number>()
    for (let port = 0; port < topology.portCount; port++)
      for (
        let slot = 0;
        slot < topology.incidentPortRegion[port]!.length;
        slot++
      ) {
        const id = port * geometry.stride + slot,
          state = geometry.state(id),
          key = geometry.templateKey(state)
        const cached = templates.get(key)
        if (cached !== undefined) {
          pointers[id] = cached
          continue
        }
        const template = geometry.templates(state),
          outgoing = template ?? options.getHops(state)
        const hops = Array.isArray(outgoing) ? outgoing : Array.from(outgoing)
        const pointer = allocate(8 + hops.length * 24)
        pointers[id] = pointer
        const region = topology.incidentPortRegion[port]![slot]!,
          columns = template
            ? new Map(
                topology.regionIncidentPorts[region]!.map((port, i) => [
                  port,
                  i,
                ]),
              )
            : undefined
        if (template) templates.set(key, pointer)
        data.setInt32(pointer, hops.length, true)
        data.setInt32(pointer + 4, template ? 1 : 0, true)
        for (let i = 0; i < hops.length; i++) {
          const hop = hops[i]!,
            owners = hop.owners ?? [],
            at = pointer + 8 + i * 24
          let ownerPointer = encodedOwners.get(owners)
          if (ownerPointer === undefined) {
            ownerPointer = allocate(owners.length * 4)
            for (let j = 0; j < owners.length; j++)
              data.setInt32(ownerPointer + j * 4, owners[j]!, true)
            encodedOwners.set(owners, ownerPointer)
          }
          data.setInt32(at, geometry.stateId(hop.state), true)
          data.setInt32(at + 4, ownerPointer, true)
          data.setInt32(at + 8, owners.length, true)
          data.setInt32(
            at + 12,
            columns?.get(
              Math.floor(geometry.stateId(hop.state) / geometry.stride),
            ) ?? 0,
            true,
          )
          data.setFloat64(at + 16, hop.distance, true)
        }
      }
  }

  mailbox.signal.fill(0)
}
export function readOwnerSearch<TState, TOwner extends number, TData>(
  mailbox: OwnerSearchMailbox,
  pointer: number,
  options: DistinctOwnerBlockerSearchOptions<TState, number, TOwner, TData>,
  geometry: OwnerGeometry<TState, TOwner, TData>,
): DistinctOwnerBlockerSearchResult<TState, TOwner, TData> {
  const data = new DataView(mailbox.memory.buffer),
    expandedLabelCount = data.getInt32(pointer + 8, true)
  if (!data.getInt32(pointer, true))
    return {
      found: false,
      reason: data.getInt32(pointer + 4, true) ? "expansion_limit" : "no_path",
      expandedLabelCount,
    }
  const count = data.getInt32(pointer + 12, true),
    path = new Int32Array(
      mailbox.memory.buffer,
      data.getInt32(pointer + 16, true),
      count * 2,
    )
  const states = Array.from({ length: count }, (_, i) =>
    geometry.state(path[i * 2]!),
  )
  const hops = states.slice(1).map((_state, i) => {
    const sourceList = new Int32Array(
      mailbox.memory.buffer,
      mailbox.config[0]!,
      mailbox.config[9]!,
    )[path[i * 2]!]!
    const outgoing = Array.from(options.getHops(states[i]!))
    const hop = data.getInt32(sourceList + 4, true)
      ? outgoing.find(
          (item) => geometry.stateId(item.state) === path[(i + 1) * 2],
        )
      : outgoing[path[(i + 1) * 2 + 1]!]
    if (!hop) throw new Error("Packed owner path contains an unavailable hop")
    return hop
  })
  const ownerCount = data.getInt32(pointer + 20, true),
    ownerPointer = data.getInt32(pointer + 24, true)
  return {
    found: true,
    states,
    hops,
    owners: new Set(
      Array.from(
        new Int32Array(mailbox.memory.buffer, ownerPointer, ownerCount),
        (id) => id as TOwner,
      ),
    ),
    distance: data.getFloat64(pointer + 32, true),
    expandedLabelCount,
  }
}
export function createOwnerSearchSession(
  mailbox: OwnerSearchMailbox,
  owner: number,
): () => void {
  Atomics.add(mailbox.config, 24, 1)
  Atomics.notify(mailbox.config, 24)
  const runner = new OwnerSearchRunner(mailbox, owner)
  return (): void => {
    try {
      const pointer = runner.run()
      Atomics.store(mailbox.signal, owner, pointer)
      Atomics.notify(mailbox.signal, owner)
    } catch (error) {
      Atomics.store(mailbox.signal, owner, -1)
      Atomics.notify(mailbox.signal, owner)
      throw error
    }
  }
}
