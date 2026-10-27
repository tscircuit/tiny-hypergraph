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
import { RouteSnapshot } from "./RouteSnapshot"

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
    private readonly beforeRead: (region: number) => void,
  ) {
    super(regionCount, index)
  }

  override dequeue(): Candidate | undefined {
    const candidate = super.dequeue()
    if (candidate) {
      if (!this.regions.has(candidate.nextRegionId))
        this.beforeRead(candidate.nextRegionId)
      this.regions.add(candidate.nextRegionId)
    }
    return candidate
  }
}

/** Runs the original TypeScript A*, capturing a result without committing it. */
class RouteSearchSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly regions = new Set<number>()
  snapshot!: RouteSnapshot
  candidate?: Candidate
  exhausted = false
  invalidated = false

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
      (region) => {
        if (
          Atomics.load(this.snapshot.context.headers, region * 8) !==
            this.snapshot.versions[region] &&
          !this.snapshot.refresh(this.regions)
        )
          this.invalidated = true
      },
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
    this.invalidated = false
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
      if (this.invalidated) return
      if (
        (this.iterations & 255) === 0 &&
        Atomics.load(this.snapshot.context.epoch, 0) !== this.snapshot.epoch &&
        !this.snapshot.refresh(this.regions)
      ) {
        this.invalidated = true
        return
      }
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
      const snapshot = new RouteSnapshot(solver, context)
      solver.snapshot = snapshot
      solver.setup()
      const versions = snapshot.versions
      Atomics.store(control, 7, 1)
      Atomics.notify(control, 7)
      while (true) {
        const state = Atomics.load(control, 0)
        if (state === 3) return
        if (state !== 1) {
          Atomics.wait(control, 0, state, 100)
          continue
        }
        const snapshotTimeStart = snapshot.timeMs
        snapshot.refresh()
        const initialCopyMs = snapshot.timeMs - snapshotTimeStart
        const searchStart = performance.now()
        solver.search(control[1]!, budget[0]!, control)
        const elapsed = performance.now() - searchStart
        budget[1] = snapshot.timeMs - snapshotTimeStart
        budget[2] = Math.max(0, elapsed - (budget[1]! - initialCopyMs))
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
          : solver.invalidated
            ? 5
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
