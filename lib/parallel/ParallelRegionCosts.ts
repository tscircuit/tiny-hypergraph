import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { TinyHyperGraphTopology } from "../core"
import type { RegionIntersectionCache } from "../types"
import {
  COST_SEGMENT_CAPACITY,
  COST_SLOT_COUNT,
  COST_SLOT_STRIDE,
  type RegionCostEntry,
  type RegionCostWorkerInput,
} from "./regionCostTypes"

const ints = (length: number): Int32Array =>
  new Int32Array(new SharedArrayBuffer(length * 4))
const doubles = (length: number): Float64Array =>
  new Float64Array(new SharedArrayBuffer(length * 8))

// Tables are optional acceleration. Bound quadratic storage on unusually large
// regions; regions outside this budget keep using the original cost function.
const MAX_TABLE_PAIRS = 32 * 1024 * 1024
const MAX_REGION_PAIRS = 1024 * 1024

export class ParallelRegionCosts {
  readonly input: RegionCostWorkerInput
  private readonly firstIndex: Int32Array
  private readonly secondIndex: Int32Array
  readonly entries: Array<RegionCostEntry | undefined>
  private version = 0
  private tasks: Promise<unknown>[] = []
  queued = 0
  readyRows = 0

  constructor(
    private readonly topology: TinyHyperGraphTopology,
    minViaPadDiameter: number,
    traceDensityCostFactor: number,
  ) {
    const { regionCount, portCount } = topology
    const pairOffsets = doubles(regionCount)
    const portOffsets = ints(regionCount + 1)
    this.firstIndex = new Int32Array(portCount).fill(-1)
    this.secondIndex = new Int32Array(portCount).fill(-1)
    let pairs = 0, ports = 0, maxPorts = 0
    for (let r = 0; r < regionCount; r++) {
      const ids = topology.regionIncidentPorts[r]!
      const regionPairs = ids.length * ids.length
      if (regionPairs <= MAX_REGION_PAIRS && pairs + regionPairs <= MAX_TABLE_PAIRS) {
        pairOffsets[r] = pairs
        pairs += regionPairs
        maxPorts = Math.max(maxPorts, ids.length)
      } else {
        pairOffsets[r] = -1
      }
      portOffsets[r] = ports
      ports += ids.length
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!
        if (topology.incidentPortRegion[id]![0] === r) this.firstIndex[id] = i
        else if (topology.incidentPortRegion[id]![1] === r) this.secondIndex[id] = i
      }
    }
    portOffsets[regionCount] = ports
    const angles = ints(ports), layers = ints(ports)
    const areas = doubles(regionCount), layerMasks = ints(regionCount)
    for (let r = 0; r < regionCount; r++) {
      areas[r] = topology.regionWidth[r]! * topology.regionHeight[r]!
      layerMasks[r] = topology.regionAvailableZMask?.[r] ?? 0
      const ids = topology.regionIncidentPorts[r]!
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!, index = portOffsets[r]! + i
        angles[index] = topology.incidentPortRegion[id]![0] === r ||
          topology.incidentPortRegion[id]![1] !== r
          ? topology.portAngleForRegion1[id]!
          : topology.portAngleForRegion2?.[id] ?? topology.portAngleForRegion1[id]!
        layers[index] = topology.portZ[id]!
      }
    }
    this.entries = new Array(regionCount)
    this.input = {
      maxPorts,
      portMasks: new Uint8Array(new SharedArrayBuffer(COST_SLOT_COUNT * maxPorts)).fill(1),
      control: ints(4 + COST_SLOT_COUNT * COST_SLOT_STRIDE),
      resultVersions: ints(regionCount),
      slotCounts: doubles(COST_SLOT_COUNT * 5),
      slotSegments: ints(COST_SLOT_COUNT * COST_SEGMENT_CAPACITY * 4),
      scores: doubles(pairs), pairOffsets, portOffsets, angles, layers, areas, layerMasks,
      minViaPadDiameter, traceDensityCostFactor,
    }
  }

  async start(runtime: SolverRuntimeExecutor): Promise<void> {
    let startupError: unknown
    // Three services plus the search coordinator use four compute threads.
    // Smaller pools are supported: queued services observe stop when dispatched.
    this.tasks = Array.from({ length: 3 }, () =>
      Promise.resolve().then(() => runtime.executeAsync("TinyHyperGraphRegionCostWorker", this.input)))
    for (const task of this.tasks) task.catch((error) => { startupError = error })
    const deadline = performance.now() + 10_000
    while (Atomics.load(this.input.control, 2) === 0) {
      if (startupError) throw startupError
      if (performance.now() > deadline) throw new Error("Region cost worker startup timed out")
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    }
  }

  prepare(region: number, netId: number, cache: RegionIntersectionCache): void {
    if (this.input.pairOffsets[region]! < 0 || cache.netIds.length > COST_SEGMENT_CAPACITY) return
    const entry = this.entries[region]
    if (entry && !entry.ready && Atomics.load(this.input.resultVersions, region) === entry.version) {
      entry.ready = true
    }
    if (entry?.cache === cache && entry.activeNetId === netId) return
    // Nets absent from this cache all see exactly the same foreign segments.
    const netKey = cache.netIds.includes(netId) ? netId : null
    if (entry?.cache === cache && entry.netId === netKey) {
      entry.activeNetId = netId
      return
    }
    // One outstanding writer per region. Never let a stale job overwrite a
    // newer table while the coordinator is reading it.
    if (entry && !entry.ready) return
    for (let slot = 0; slot < COST_SLOT_COUNT; slot++) {
      const base = 4 + slot * COST_SLOT_STRIDE
      if (Atomics.compareExchange(this.input.control, base, 0, 3) !== 0) continue
      const version = ++this.version
      this.entries[region] = { cache, netId: netKey, activeNetId: netId, version, ready: false }
      const start = slot * COST_SEGMENT_CAPACITY * 4
      const fields = [cache.netIds, cache.lesserAngles, cache.greaterAngles, cache.layerMasks]
      for (let i = 0; i < 4; i++) {
        this.input.slotSegments.set(fields[i]!, start + i * COST_SEGMENT_CAPACITY)
      }
      this.input.slotCounts.set([
        cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections,
        cache.existingEntryExitLayerChanges, cache.existingRegionCost, cache.existingSegmentCount,
      ], slot * 5)
      this.input.control[base + 1] = region
      this.input.control[base + 2] = netId
      this.input.control[base + 3] = cache.netIds.length
      this.input.control[base + 4] = version
      this.queued++
      Atomics.store(this.input.control, base, 1)
      Atomics.add(this.input.control, 1, 1)
      Atomics.notify(this.input.control, 1)
      break
    }
  }

  getReadyRow(region: number, port: number, cache: RegionIntersectionCache, netId: number): number {
    const entry = this.entries[region]
    if (!entry?.ready || entry.cache !== cache || entry.activeNetId !== netId) return -1
    const regions = this.topology.incidentPortRegion[port]!
    const index = regions[0] === region ? this.firstIndex[port]!
      : regions[1] === region ? this.secondIndex[port]! : -1
    if (index < 0) return -1
    this.readyRows++
    return this.input.pairOffsets[region]! + index * this.topology.regionIncidentPorts[region]!.length
  }

  async close(): Promise<void> {
    Atomics.store(this.input.control, 0, 1)
    Atomics.add(this.input.control, 1, 1)
    Atomics.notify(this.input.control, 1)
    const outcomes = await Promise.allSettled(this.tasks)
    const failure = outcomes.find((outcome) => outcome.status === "rejected")
    if (failure?.status === "rejected") throw failure.reason
  }
}
