import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import type { SharedRouteContext } from "./SharedRouteGraph"

export type RegionCostInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  context: SharedRouteContext
  control: Int32Array
  jobs: Int32Array
  owned: Int32Array
  offsets: Int32Array
  values: Float64Array
  counters: Float64Array
  worker: number
}

/** Computes exact, route-independent transition costs on a frozen graph. */
export class RegionCostTask {
  static readonly solverName = "RegionCostTask"
  constructor(private readonly input: RegionCostInput) {}

  solve(): void {
    const {
      topology,
      problem,
      options,
      context,
      control,
      jobs,
      offsets,
      owned,
      values,
      counters,
      worker,
    } = this.input
    try {
      const solver = new TinyHyperGraphSolver(
        topology,
        { ...problem, portPenalty: undefined },
        {
          ...options,
          DISTANCE_TO_COST: 0,
          STATIC_REACHABILITY_PRECHECK: false,
          VERBOSE: false,
        },
      )
      // No Int32 segment net equals NaN: this table represents a new net.
      // Regions containing the actual route's net are scored by the caller.
      solver.state.currentRouteNetId = Number.NaN
      const versions = new Int32Array(topology.regionCount).fill(-1)
      let previousRound = 0
      Atomics.add(control, 6, 1)
      Atomics.notify(control, 6)
      while (Atomics.load(control, 4) === 0) {
        const round = Atomics.load(control, 0)
        if (round === previousRound) {
          Atomics.wait(control, 0, round, 100)
          continue
        }
        previousRound = round
        const start = performance.now()
        let cells = 0,
          tables = 0
        let index = worker
        while (index < control[1]!) {
          const region = jobs[index * 3]!
          const firstRow = jobs[index * 3 + 1]!
          const lastRow = jobs[index * 3 + 2]!
          solver.state.currentRouteNetId = owned[region]
            ? control[7]!
            : Number.NaN
          const row = region * 8
          const version = Atomics.load(context.headers, row)
          if (version !== versions[region]) {
            const offset = context.headers[row + 1]!,
              capacity = context.headers[row + 2]!,
              count = context.headers[row + 3]!
            // The coordinator never mutates the graph until all workers reach
            // the barrier, so these shared read-only views remain consistent.
            solver.state.regionIntersectionCaches[region] = {
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
            versions[region] = version
          }
          const ports = topology.regionIncidentPorts[region]!
          const base = offsets[region]!,
            count = ports.length
          const candidate: Candidate = {
            portId: 0,
            nextRegionId: region,
            f: 0,
            g: 0,
            h: 0,
          }
          for (let from = firstRow; from < lastRow; from++) {
            candidate.portId = ports[from]!
            for (let to = from; to < count; to++) {
              const cost = solver.computeG(candidate, ports[to]!, Infinity, 0)
              values[base + from * count + to] = cost
              values[base + to * count + from] = cost
              cells++
            }
          }
          if (firstRow === 0) tables++
          index = Atomics.add(control, 2, 1)
        }
        counters[worker * 3] += performance.now() - start
        counters[worker * 3 + 1] += tables
        counters[worker * 3 + 2] += cells
        Atomics.add(control, 3, 1)
        Atomics.notify(control, 3)
      }
    } catch (error) {
      Atomics.store(control, 5, 1)
      Atomics.notify(control, 3)
      Atomics.notify(control, 6)
      throw error
    }
  }

  getOutput(): Record<string, never> {
    return {}
  }
}

export class RegionCostReadyTask {
  static readonly solverName = "RegionCostReadyTask"
  constructor(_input: Record<string, never>) {}
  solve(): void {}
  getOutput(): Record<string, never> {
    return {}
  }
}
