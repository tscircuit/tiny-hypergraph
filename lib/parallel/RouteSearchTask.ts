import {
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../core"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import {
  IndexedCandidateHeap,
  type CompactCandidateHopIndex,
} from "../indexed-candidate-heap"
import type { SharedRouteContext } from "./SharedRouteGraph"

export type RouteSearchInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  context: SharedRouteContext
  control: Int32Array
  budget: Float64Array
  pathIds: Int32Array
  pathCosts: Float64Array
  dependencies: Int32Array
}

class ObservedCandidateHeap extends IndexedCandidateHeap {
  constructor(
    regionCount: number,
    index: CompactCandidateHopIndex,
    private readonly regions: Set<number>,
  ) {
    super(regionCount, index)
  }

  override dequeue(): Candidate | undefined {
    const candidate = super.dequeue()
    if (candidate) this.regions.add(candidate.nextRegionId)
    return candidate
  }
}

/** Runs the original TypeScript A*, capturing a result without committing it. */
class RouteSearchSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly regions = new Set<number>()
  candidate?: Candidate
  exhausted = false

  override _setup(): void {
    super._setup()
    this.state.candidateQueue = new ObservedCandidateHeap(
      this.topology.regionCount,
      {
        hopCapacity: this.candidateHopCapacity,
        hopSlotStride: this.candidateHopSlotStride,
        firstRegionByPortId: this.candidateFirstRegionByPortId,
        secondRegionByPortId: this.candidateSecondRegionByPortId,
        incidentPortRegion: this.topology.incidentPortRegion,
      },
      this.regions,
    )
  }

  override onPathFound(candidate: Candidate): void {
    if (candidate.portId !== this.state.goalPortId) {
      super.onPathFound(candidate)
      return
    }
    this.candidate = candidate
    this.solved = true
  }

  override onOutOfCandidates(): void {
    this.exhausted = true
    this.solved = true
  }

  override tryFinalAcceptance(): void {}

  search(routeId: number, budget: number, control: Int32Array): void {
    this.candidate = undefined
    this.exhausted = false
    this.regions.clear()
    this.iterations = 0
    this.MAX_ITERATIONS = budget
    this.solved = false
    this.failed = false
    this.error = null
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = [routeId]
    this.state.candidateQueue.clear()
    while (!this.solved && !this.failed) {
      if (
        (this.iterations & 255) === 0 &&
        (Atomics.load(control, 0) === 3 || Atomics.load(control, 9) !== 0)
      )
        return
      this.step()
    }
    if (this.failed && this.iterations < budget)
      throw new Error(this.error ?? "Route search failed")
  }
}

/** One persistent task per worker; graph snapshots and results use shared buffers. */
export class RouteSearchTask {
  static readonly solverName = "RouteSearchTask"
  constructor(private readonly input: RouteSearchInput) {}

  solve(): void {
    const {
      topology,
      problem,
      options,
      control,
      budget,
      context,
      pathIds,
      pathCosts,
      dependencies,
    } = this.input
    try {
      const solver = new RouteSearchSolver(topology, problem, {
        ...options,
        STATIC_REACHABILITY_PRECHECK: false,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        VERBOSE: false,
      })
      solver.setup()
      const versions = new Int32Array(topology.regionCount).fill(-1)
      Atomics.store(control, 7, 1)
      Atomics.notify(control, 7)
      while (true) {
        const state = Atomics.load(control, 0)
        if (state === 3) return
        if (state !== 1) {
          Atomics.wait(control, 0, state, 100)
          continue
        }
        // Copy an immutable local view. The writer's epoch covers assignment,
        // congestion and every changed region-cache row as one transaction.
        while (true) {
          const epoch = Atomics.load(context.epoch, 0)
          if (epoch & 1) {
            Atomics.wait(context.epoch, 0, epoch, 100)
            continue
          }
          solver.state.portAssignment.set(context.assignment)
          solver.state.regionCongestionCost.set(context.congestion)
          const changed: Array<[number, number]> = []
          for (let region = 0; region < topology.regionCount; region++) {
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
          for (const [region, version] of changed) versions[region] = version
          break
        }
        solver.search(control[1]!, budget[0]!, control)
        if (Atomics.load(control, 0) === 3) return
        const canceled = Atomics.load(control, 9) !== 0
        let count = 0
        for (
          let candidate = solver.candidate;
          candidate;
          candidate = candidate.prevCandidate
        ) {
          if (count * 4 + 3 >= pathIds.length)
            throw new Error("Route result exceeds hop capacity")
          pathIds[count * 4] = candidate.portId
          pathIds[count * 4 + 1] = candidate.nextRegionId
          pathIds[count * 4 + 2] =
            candidate.hopId ??
            solver.getHopId(candidate.portId, candidate.nextRegionId)
          pathIds[count * 4 + 3] = candidate.prevRegionId ?? -1
          pathCosts[count * 3] = candidate.f
          pathCosts[count * 3 + 1] = candidate.g
          pathCosts[count * 3 + 2] = candidate.h
          count++
        }
        let index = 0
        for (const region of solver.regions) {
          dependencies[index * 2] = region
          dependencies[index * 2 + 1] = versions[region]!
          index++
        }
        control[3] = canceled
          ? 4
          : solver.candidate
            ? 1
            : solver.exhausted
              ? 2
              : 3
        control[4] = solver.iterations
        control[5] = count
        control[6] = index
        if (Atomics.compareExchange(control, 0, 1, 2) !== 1) return
        Atomics.notify(control, 0)
        // The coordinator acknowledges the buffers before assigning new work.
        while (Atomics.load(control, 0) === 2) Atomics.wait(control, 0, 2, 100)
      }
    } catch (error) {
      Atomics.store(control, 0, -1)
      Atomics.notify(control, 0)
      Atomics.notify(control, 7)
      throw error
    }
  }

  getOutput(): Record<string, never> {
    return {}
  }
}

/** Starts a worker while the coordinator prepares the topology. */
export class RouteSearchReadyTask {
  static readonly solverName = "RouteSearchReadyTask"
  constructor(_input: Record<string, never>) {}
  solve(): void {}
  getOutput(): Record<string, never> {
    return {}
  }
}
