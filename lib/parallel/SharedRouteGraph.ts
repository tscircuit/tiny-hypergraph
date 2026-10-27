import { type TinyHyperGraphSolver } from "../core"

export type SharedRouteContext = {
  headers: Int32Array
  costs: Float64Array
  storage: Int32Array
  assignment: Int32Array
  congestion: Float64Array
  epoch: Int32Array
}

export class SharedRouteGraph {
  generation = 0
  readonly context: SharedRouteContext
  private usedWords = 0
  private caches: TinyHyperGraphSolver["state"]["regionIntersectionCaches"] = []
  constructor(
    private solver: TinyHyperGraphSolver,
    context?: SharedRouteContext,
  ) {
    const topology = solver.topology,
      regions = topology.regionCount
    this.context = context ?? {
      headers: new Int32Array(new SharedArrayBuffer(regions * 8 * 4)),
      costs: new Float64Array(new SharedArrayBuffer(regions * 8)),
      storage: new Int32Array(
        new SharedArrayBuffer(Math.max(1024, topology.portCount * 64) * 4 * 4),
      ),
      assignment: new Int32Array(new SharedArrayBuffer(topology.portCount * 4)),
      congestion: new Float64Array(new SharedArrayBuffer(regions * 8)),
      epoch: new Int32Array(new SharedArrayBuffer(4)),
    }
    this.sync()
  }
  rebind(solver: TinyHyperGraphSolver): void {
    if (
      solver.topology !== this.solver.topology ||
      solver.problem !== this.solver.problem
    )
      throw new Error("Cannot rebind a different route graph")
    this.solver = solver
    this.caches = []
    this.generation++
  }
  sync(): void {
    const ctx = this.context
    Atomics.add(ctx.epoch, 0, 1)
    try {
      let additive = true
      const dirty = new Uint8Array(this.solver.topology.regionCount)
      for (let port = 0; port < ctx.assignment.length; port++) {
        if (ctx.assignment[port] !== this.solver.state.portAssignment[port]) {
          if (ctx.assignment[port] !== -1) additive = false
          for (const region of this.solver.topology.incidentPortRegion[port])
            dirty[region] = 1
        }
      }
      for (
        let region = 0;
        region < this.solver.topology.regionCount;
        region++
      ) {
        const previous = this.caches[region]
        const next = this.solver.state.regionIntersectionCaches[region]!
        if (
          ctx.congestion[region]! >
          this.solver.state.regionCongestionCost[region]!
        )
          additive = false
        if (previous && previous !== next) {
          if (
            previous.netIds.length > next.netIds.length ||
            next.existingRegionCost < ctx.costs[region]! ||
            next.existingCrossingLayerIntersections <
              ctx.headers[region * 8 + 4]! ||
            next.existingSameLayerIntersections <
              ctx.headers[region * 8 + 5]! ||
            next.existingEntryExitLayerChanges < ctx.headers[region * 8 + 6]!
          )
            additive = false
          else
            for (let i = 0; i < previous.netIds.length; i++) {
              if (
                previous.netIds[i] !== next.netIds[i] ||
                previous.lesserAngles[i] !== next.lesserAngles[i] ||
                previous.greaterAngles[i] !== next.greaterAngles[i] ||
                previous.layerMasks[i] !== next.layerMasks[i]
              ) {
                additive = false
                break
              }
            }
        }
        if (
          dirty[region] ||
          ctx.congestion[region] !==
            this.solver.state.regionCongestionCost[region] ||
          this.caches[region] !==
            this.solver.state.regionIntersectionCaches[region]
        ) {
          Atomics.add(ctx.headers, region * 8, 1)
          this.writeRegion(region)
          Atomics.add(ctx.headers, region * 8, 1)
        }
      }
      ctx.assignment.set(this.solver.state.portAssignment)
      ctx.congestion.set(this.solver.state.regionCongestionCost)
      if (!additive) this.generation++
    } finally {
      Atomics.add(ctx.epoch, 0, 1)
      Atomics.notify(ctx.epoch, 0)
    }
  }
  private writeRegion(region: number): void {
    const ctx = this.context
    const row = region * 8
    const cache = this.solver.state.regionIntersectionCaches[region]
    const count = cache.netIds.length
    let capacity = ctx.headers[row + 2]
    let offset = ctx.headers[row + 1]
    if (count > capacity) {
      capacity = 2 ** Math.ceil(Math.log2(count))
      offset = this.usedWords
      this.usedWords += capacity * 4
      if (this.usedWords > ctx.storage.length)
        throw new Error("Shared route-cache storage exhausted")
      ctx.headers[row + 1] = offset
      ctx.headers[row + 2] = capacity
    }
    ctx.storage.set(cache.netIds, offset)
    ctx.storage.set(cache.lesserAngles, offset + capacity)
    ctx.storage.set(cache.greaterAngles, offset + capacity * 2)
    ctx.storage.set(cache.layerMasks, offset + capacity * 3)
    ctx.headers[row + 3] = count
    ctx.headers[row + 4] = cache.existingCrossingLayerIntersections
    ctx.headers[row + 5] = cache.existingSameLayerIntersections
    ctx.headers[row + 6] = cache.existingEntryExitLayerChanges
    ctx.headers[row + 7] = cache.existingSegmentCount
    ctx.costs[region] = cache.existingRegionCost
    this.caches[region] = cache
  }
}
