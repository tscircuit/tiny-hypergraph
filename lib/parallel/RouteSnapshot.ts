import type { TinyHyperGraphSolver } from "../core"
import type { SharedRouteContext } from "./SharedRouteGraph"

/** A search may advance its snapshot only while its entire read set is unchanged. */
export class RouteSnapshot {
  readonly versions: Int32Array
  epoch = -1
  timeMs = 0

  constructor(
    private readonly solver: TinyHyperGraphSolver,
    readonly context: SharedRouteContext,
  ) {
    this.versions = new Int32Array(solver.topology.regionCount).fill(-1)
  }

  refresh(readRegions?: ReadonlySet<number>): boolean {
    const start = performance.now()
    const { context, solver, versions } = this
    try {
      while (true) {
        const epoch = Atomics.load(context.epoch, 0)
        if (epoch & 1) {
          Atomics.wait(context.epoch, 0, epoch, 100)
          continue
        }
        if (readRegions)
          for (const region of readRegions) {
            if (Atomics.load(context.headers, region * 8) !== versions[region])
              return false
          }
        solver.state.portAssignment.set(context.assignment)
        solver.state.regionCongestionCost.set(context.congestion)
        const changed: Array<[number, number]> = []
        for (let region = 0; region < solver.topology.regionCount; region++) {
          const row = region * 8
          const version = Atomics.load(context.headers, row)
          if (version === versions[region]) continue
          const offset = context.headers[row + 1]!,
            capacity = context.headers[row + 2]!,
            count = context.headers[row + 3]!
          solver.state.regionIntersectionCaches[region] = {
            netIds: context.storage.slice(offset, offset + count),
            lesserAngles: context.storage.slice(
              offset + capacity,
              offset + capacity + count,
            ),
            greaterAngles: context.storage.slice(
              offset + capacity * 2,
              offset + capacity * 2 + count,
            ),
            layerMasks: context.storage.slice(
              offset + capacity * 3,
              offset + capacity * 3 + count,
            ),
            existingCrossingLayerIntersections: context.headers[row + 4]!,
            existingSameLayerIntersections: context.headers[row + 5]!,
            existingEntryExitLayerChanges: context.headers[row + 6]!,
            existingSegmentCount: context.headers[row + 7]!,
            existingRegionCost: context.costs[region]!,
          }
          changed.push([region, version])
        }
        if (epoch !== Atomics.load(context.epoch, 0)) continue
        this.epoch = epoch
        for (const [region, version] of changed) versions[region] = version
        return true
      }
    } finally {
      this.timeMs += performance.now() - start
    }
  }
}
