import type { TinyHyperGraphSolver } from "../core"
import type { SharedRouteContext } from "./SharedRouteGraph"

/** Shared reads are provisional until the coordinator validates every version. */
export class RouteSnapshot {
  readonly versions: Int32Array
  timeMs = 0

  constructor(
    private readonly solver: TinyHyperGraphSolver,
    readonly context: SharedRouteContext,
  ) {
    this.versions = new Int32Array(solver.topology.regionCount).fill(-1)
    // Searches never commit or mutate these arrays. A writer changes the version
    // of every incident region before changing an assignment or congestion cost.
    solver.state.portAssignment = context.assignment
    solver.state.regionCongestionCost = context.congestion
  }

  read(region: number): void {
    const start = performance.now()
    const { context, solver, versions } = this
    try {
      while (true) {
        const epoch = Atomics.load(context.epoch, 0)
        if (epoch & 1) {
          Atomics.wait(context.epoch, 0, epoch, 100)
          continue
        }
        const row = region * 8
        const version = Atomics.load(context.headers, row)
        if (version === versions[region]) return
        const offset = context.headers[row + 1]!,
          capacity = context.headers[row + 2]!,
          count = context.headers[row + 3]!
        const cache = {
          netIds: context.storage.subarray(offset, offset + count),
          lesserAngles: context.storage.subarray(
            offset + capacity,
            offset + capacity + count,
          ),
          greaterAngles: context.storage.subarray(
            offset + capacity * 2,
            offset + capacity * 2 + count,
          ),
          layerMasks: context.storage.subarray(
            offset + capacity * 3,
            offset + capacity * 3 + count,
          ),
          existingCrossingLayerIntersections: context.headers[row + 4]!,
          existingSameLayerIntersections: context.headers[row + 5]!,
          existingEntryExitLayerChanges: context.headers[row + 6]!,
          existingSegmentCount: context.headers[row + 7]!,
          existingRegionCost: context.costs[region]!,
        }
        if (epoch !== Atomics.load(context.epoch, 0)) continue
        solver.state.regionIntersectionCaches[region] = cache
        versions[region] = version
        return
      }
    } finally {
      this.timeMs += performance.now() - start
    }
  }
}
