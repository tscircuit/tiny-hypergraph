import { findDisconnectedOwnerGraph } from "./findDisconnectedOwnerGraph"
import { type DistinctOwnerBlockerSearchOptions, type DistinctOwnerBlockerSearchResult, type DistinctOwnerBlockerHop } from "../find-distinct-owner-blocker-path"
import { ownerKernelBytes } from "./wasm/ownerKernelBytes"
type Exports = WebAssembly.Exports & { reset(): void; allocate(bytes: number): number; search(limit: number, start: number): number; geometry(stride: number, goal: number): void }
type Callbacks = { hops(state: number): number; goal(state: number): number; distance?(a: number, b: number): number }
let module: WebAssembly.Module | undefined
class Engine {
  readonly memory = new WebAssembly.Memory({ initial: 2, maximum: 16384 })
  readonly exports: Exports
  callbacks?: Callbacks
  busy = false
  constructor() {
    module ??= new WebAssembly.Module(ownerKernelBytes)
    this.exports = new WebAssembly.Instance(module, { env: { memory: this.memory,
      load_hops: (state: number) => this.callbacks!.hops(state),
      is_goal: (state: number) => this.callbacks!.goal(state),
      edge_distance: (a: number, b: number) => this.callbacks!.distance!(a, b),
      invalid_distance: (overflow: number) => { throw new Error(overflow ? "Distinct-owner blocker path distance overflowed" : "Distinct-owner blocker hops require finite distances >= 0") },
    } }).exports as Exports
  }
}
const engines: Engine[] = []
export type OwnerGeometry<TState, TOwner, TData> = {
  stride: number; goal: number
  stateId(state: TState): number; state(id: number): TState
  templateKey(state: TState): number
  templates(state: TState): Array<DistinctOwnerBlockerHop<TState, TOwner, TData>> | undefined
  distance(a: number, b: number): number
  nativeGraph?: { cacheToken?: object; assignment: Int32Array; portOwners: ReadonlyMap<number, ReadonlySet<number>>; segments: Array<Array<[number, number, number]>>; net: number; forbidden: ReadonlySet<number> }
}
/** Same label ordering and dominance policy as the JS search; topology callbacks stay on the caller. */
export function findOwnerPathInWasm<TState, TKey, TOwner, TData>(options: DistinctOwnerBlockerSearchOptions<TState, TKey, TOwner, TData>, geometry?: OwnerGeometry<TState, TOwner, TData>): DistinctOwnerBlockerSearchResult<TState, TOwner, TData> {
  const limit = options.maxExpandedLabels ?? Infinity
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 0)) throw new Error("maxExpandedLabels must be a non-negative integer")
  if (options.checkReachability) {
    const disconnected = findDisconnectedOwnerGraph(options, limit)
    if (disconnected) return disconnected
  }
  const engine = engines.find((item) => !item.busy) ?? new Engine()
  if (!engines.includes(engine)) engines.push(engine)
  engine.busy = true; engine.exports.reset()
  if (geometry) engine.exports.geometry(geometry.stride, geometry.goal)
  const templates = new Map<number, number>()
  const stateValue = (id: number): TState => geometry ? geometry.state(id) : states[id]!
  const states: TState[] = [options.start], stateIds = new Map<TKey, number>([[options.getStateKey(options.start), 0]])
  const lists: Array<Array<DistinctOwnerBlockerHop<TState, TOwner, TData>>> = []
  const owners: TOwner[] = [], ownerIds = new Map<TOwner, number>(), ownerArrays = new WeakMap<readonly TOwner[], { pointer: number; count: number }>()
  engine.callbacks = {
    goal: (state) => Number(options.isGoal(stateValue(state))),
    distance: geometry?.distance,
    hops: (state) => {
      const value = stateValue(state), key = geometry?.templateKey(value)
      const existing = key === undefined ? undefined : templates.get(key)
      if (existing !== undefined) return existing
      const template = geometry?.templates(value)
      const outgoing = template ?? options.getHops(value)
      const hops = Array.isArray(outgoing) ? outgoing : Array.from(outgoing); lists[state] = hops
      const pointer = engine.exports.allocate(8 + hops.length * 24)
      let data = new DataView(engine.memory.buffer)
      data.setInt32(pointer, hops.length, true); data.setInt32(pointer + 4, template ? 1 : 0, true)
      if (template) templates.set(key!, pointer)
      for (let i = 0; i < hops.length; i++) {
        const hop = hops[i]!
        const key = options.getStateKey(hop.state)
        let target = geometry ? geometry.stateId(hop.state) : stateIds.get(key)
        if (target === undefined) { target = states.length; states.push(hop.state); stateIds.set(key, target) }
        let encoded = hop.owners ? ownerArrays.get(hop.owners) : undefined
        if (!encoded) {
          const ids: number[] = []
          for (const owner of hop.owners ?? []) {
            let id = ownerIds.get(owner)
            if (id === undefined) { id = owners.length; owners.push(owner); ownerIds.set(owner, id) }
            ids.push(id)
          }
          const pointer = engine.exports.allocate(ids.length * 4)
          new Int32Array(engine.memory.buffer, pointer, ids.length).set(ids)
          encoded = { pointer, count: ids.length }
          if (hop.owners) ownerArrays.set(hop.owners, encoded)
        }
        if (data.buffer !== engine.memory.buffer) data = new DataView(engine.memory.buffer)
        const at = pointer + 8 + i * 24
        data.setInt32(at, target, true); data.setInt32(at + 4, encoded.pointer, true); data.setInt32(at + 8, encoded.count, true); data.setInt32(at + 12, 0, true); data.setFloat64(at + 16, hop.distance, true)
      }
      return pointer
    },
  }
  try {
    const pointer = engine.exports.search(limit, geometry ? geometry.stateId(options.start) : 0), data = new DataView(engine.memory.buffer)
    const found = data.getInt32(pointer, true), expandedLabelCount = data.getInt32(pointer + 8, true)
    if (!found) return { found: false, reason: data.getInt32(pointer + 4, true) ? "expansion_limit" : "no_path", expandedLabelCount }
    const count = data.getInt32(pointer + 12, true), pathPointer = data.getInt32(pointer + 16, true)
    const path = new Int32Array(engine.memory.buffer, pathPointer, count * 2)
    const resultStates: TState[] = [], resultHops: Array<DistinctOwnerBlockerHop<TState, TOwner, TData>> = []
    for (let i = 0; i < count; i++) {
      resultStates.push(stateValue(path[i * 2]!))
      if (i) {
        if (geometry) {
          const hop = Array.from(options.getHops(resultStates[i - 1]!)).find((item) => geometry.stateId(item.state) === path[i * 2])
          if (!hop) throw new Error("Compiled owner path contains an unavailable hop")
          resultHops.push(hop)
        } else resultHops.push(lists[path[(i - 1) * 2]!]![path[i * 2 + 1]!]!)
      }
    }
    const ownerCount = data.getInt32(pointer + 20, true), ownerPointer = data.getInt32(pointer + 24, true)
    const resultOwners = new Set(Array.from(new Int32Array(engine.memory.buffer, ownerPointer, ownerCount), (id) => owners[id]!))
    return { found: true, states: resultStates, hops: resultHops, owners: resultOwners, distance: data.getFloat64(pointer + 32, true), expandedLabelCount }
  } finally { engine.callbacks = undefined; engine.busy = false }
}
