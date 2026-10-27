import {
  type Candidate,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "../core"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import {
  IndexedCandidateHeap,
  type CompactCandidateHopIndex,
} from "../indexed-candidate-heap"
import type { SharedRouteContext } from "./SharedRouteGraph"

export const SEARCH_CONTROL = {
  query: 0,
  ready: 1,
  done: 2,
  stop: 3,
  error: 4,
  route: 5,
  budget: 6,
  tokens: 7,
  result: 8,
  goal: 9,
  barrierCount: 10,
  barrierEpoch: 11,
} as const
export type DistributedSearchInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  context: SharedRouteContext
  control: Int32Array
  published: Float64Array
  parents: Int32Array
  bounds: Float64Array
  work: Int32Array
  messageCounts: Int32Array
  messageIds: Int32Array
  messageCosts: Float64Array
  counters: Float64Array
  owner: number
  workers: number
  capacity: number
  batchSize: number
}
type SearchCandidate = Candidate & { parentHop?: number }

class DistributedHeap extends IndexedCandidateHeap {
  constructor(
    regionCount: number,
    index: CompactCandidateHopIndex,
    private readonly solver: DistributedSolver,
  ) {
    super(regionCount, index)
  }
  override isClosedHopId(hopId: number): boolean {
    return this.solver.input.workers === 1 ? super.isClosedHopId(hopId) : false
  }
  override queue(candidate: Candidate): void {
    this.solver.enqueue(candidate)
  }
  queueLocal(candidate: Candidate): void {
    this.reopenHop(candidate.hopId!)
    super.queue(candidate)
  }
}

class DistributedSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly best: Float64Array
  readonly sent: Float64Array
  readonly changed: number[] = []
  readonly versions: Int32Array
  heap!: DistributedHeap
  goalBest = Infinity
  goalFirst = 0
  goalLast = 0
  batches = 0
  relaxations = 0
  messages = 0

  constructor(readonly input: DistributedSearchInput) {
    super(input.topology, input.problem, {
      ...input.options,
      STATIC_REACHABILITY_PRECHECK: false,
      OWNED_REGIONAL_HOP_FRONTIER: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      MAX_ITERATIONS: Infinity,
      VERBOSE: false,
    })
    this.best = new Float64Array(input.published.length)
    this.sent = new Float64Array(input.published.length)
    this.versions = new Int32Array(input.topology.regionCount).fill(-1)
  }

  override _setup(): void {
    super._setup()
    this.heap = new DistributedHeap(
      this.topology.regionCount,
      {
        hopCapacity: this.candidateHopCapacity,
        hopSlotStride: this.candidateHopSlotStride,
        firstRegionByPortId: this.candidateFirstRegionByPortId,
        secondRegionByPortId: this.candidateSecondRegionByPortId,
        incidentPortRegion: this.topology.incidentPortRegion,
      },
      this,
    )
    this.state.candidateQueue = this.heap
  }

  owner(hop: number): number {
    return hop >= this.goalFirst && hop < this.goalLast
      ? 0
      : hop & (this.input.workers - 1)
  }
  override getCandidateBestCost(hop: number): number {
    if (this.owner(hop) === this.input.owner) return this.best[hop]!
    return Math.min(this.input.published[hop]!, this.sent[hop]!)
  }
  override setCandidateBestCost(hop: number, value: number): void {
    if (this.owner(hop) === this.input.owner) {
      this.best[hop] = value
      this.changed.push(hop)
    } else this.sent[hop] = value
  }

  enqueue(candidate: SearchCandidate): void {
    const hop =
      candidate.hopId ?? this.getHopId(candidate.portId, candidate.nextRegionId)
    if (hop < 0 || hop >= this.best.length)
      throw new Error("Distributed search requires incident hop IDs")
    const parent = candidate.prevCandidate?.hopId ?? candidate.parentHop ?? -1
    const destination = this.owner(hop)
    if (destination === this.input.owner) {
      if (candidate.g > this.best[hop]!) return
      if (candidate.g < this.best[hop]!)
        this.setCandidateBestCost(hop, candidate.g)
      this.input.parents[hop] = parent
      candidate.hopId = hop
      candidate.prevCandidate = undefined
      this.heap.queueLocal(candidate)
      if (
        candidate.portId === this.state.goalPortId &&
        candidate.g < this.goalBest
      ) {
        this.goalBest = candidate.g
        this.input.control[SEARCH_CONTROL.goal] = hop
      }
      this.relaxations++
      return
    }
    const queue = this.input.owner * this.input.workers + destination
    const index = this.input.messageCounts[queue]!
    if (index >= this.input.capacity)
      throw new Error("Distributed search message capacity exceeded")
    const offset = (queue * this.input.capacity + index) * 2
    this.input.messageIds[offset] = hop
    this.input.messageIds[offset + 1] = parent
    this.input.messageCosts[offset] = candidate.g
    this.input.messageCosts[offset + 1] = candidate.h
    this.input.messageCounts[queue] = index + 1
    this.messages++
  }

  override onPathFound(candidate: Candidate): void {
    if (candidate.portId !== this.state.goalPortId) super.onPathFound(candidate)
  }
  override onOutOfCandidates(): void {}
  override tryFinalAcceptance(): void {}

  private barrier(): void {
    const c = this.input.control,
      C = SEARCH_CONTROL
    const epoch = Atomics.load(c, C.barrierEpoch)
    if (Atomics.add(c, C.barrierCount, 1) === this.input.workers - 1) {
      Atomics.store(c, C.barrierCount, 0)
      Atomics.add(c, C.barrierEpoch, 1)
      Atomics.notify(c, C.barrierEpoch)
    } else
      while (Atomics.load(c, C.barrierEpoch) === epoch) {
        if (Atomics.load(c, C.error) || Atomics.load(c, C.stop))
          throw new Error("Distributed search barrier aborted")
        Atomics.wait(c, C.barrierEpoch, epoch, 100)
      }
  }

  private publish(): void {
    for (const hop of this.changed) this.input.published[hop] = this.best[hop]!
    this.changed.length = 0
    this.input.bounds[this.input.owner] = this.heap.peek()?.f ?? Infinity
    if (this.input.owner === 0)
      this.input.bounds[this.input.workers] = this.goalBest
  }

  private finishRound(): void {
    if (this.input.owner !== 0) return
    const { control: c, work, bounds, workers } = this.input,
      C = SEARCH_CONTROL
    let used = 0,
      minimum = Infinity
    for (let owner = 0; owner < workers; owner++) {
      used += work[owner]!
      minimum = Math.min(minimum, bounds[owner]!)
    }
    c[C.tokens] += used
    c[C.result] =
      Number.isFinite(this.goalBest) && minimum >= this.goalBest
        ? 1
        : minimum === Infinity
          ? 2
          : c[C.tokens]! >= c[C.budget]!
            ? 3
            : 0
  }

  search(): void {
    const {
        control: c,
        context,
        topology,
        workers,
        owner,
        bounds,
      } = this.input,
      C = SEARCH_CONTROL
    this.best.fill(Infinity)
    this.sent.fill(Infinity)
    this.heap.clear()
    this.changed.length = 0
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.batches = 0
    this.messages = 0
    this.relaxations = 0
    this.goalBest = Infinity
    const route = c[C.route]!
    this.state.currentRouteId = route
    this.state.currentRouteNetId = this.problem.routeNet[route]!
    this.state.goalPortId = this.problem.routeEndPort[route]!
    this.goalFirst = this.state.goalPortId * this.candidateHopSlotStride
    this.goalLast = this.goalFirst + this.candidateHopSlotStride
    this.state.portAssignment = context.assignment
    this.state.regionCongestionCost = context.congestion
    for (let region = 0; region < topology.regionCount; region++) {
      const row = region * 8,
        version = Atomics.load(context.headers, row)
      if (this.versions[region] === version) continue
      const offset = context.headers[row + 1]!,
        capacity = context.headers[row + 2]!,
        count = context.headers[row + 3]!
      this.state.regionIntersectionCaches[region] = {
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
      this.versions[region] = version
    }
    const start = this.problem.routeStartPort[route]!,
      region = this.getStartingNextRegionId(route, start)
    if (region === undefined)
      throw new Error("Distributed route start has no region")
    const hop = this.getHopId(start, region)
    if (this.owner(hop) === owner) {
      this.setCandidateBestCost(hop, 0)
      this.enqueue({
        hopId: hop,
        portId: start,
        nextRegionId: region,
        g: 0,
        f: 0,
        h: 0,
      })
    }
    this.input.work[owner] = 0
    this.publish()
    this.barrier()
    this.finishRound()
    this.barrier()
    while (c[C.result] === 0) {
      const goalBound = bounds[workers]!
      let minimum = Infinity
      for (let i = 0; i < workers; i++) minimum = Math.min(minimum, bounds[i]!)
      const threshold = minimum + Math.max(1e-9, this.DISTANCE_TO_COST * 0.5)
      let active = 0,
        rank = 0
      for (let i = 0; i < workers; i++)
        if (bounds[i]! <= threshold && bounds[i]! < goalBound) {
          if (i < owner) rank++
          active++
        }
      const remaining = c[C.budget]! - c[C.tokens]!
      const eligible = bounds[owner]! <= threshold && bounds[owner]! < goalBound
      const quota =
        eligible && active
          ? Math.min(
              this.input.batchSize,
              Math.floor(remaining / active) +
                (rank < remaining % active ? 1 : 0),
            )
          : 0
      for (let destination = 0; destination < workers; destination++)
        this.input.messageCounts[owner * workers + destination] = 0
      let used = 0
      while (used < quota) {
        const candidate = this.heap.peek()
        const limit = owner === 0 ? this.goalBest : goalBound
        if (!candidate || candidate.f > threshold || candidate.f >= limit) break
        this.step()
        used++
      }
      this.input.work[owner] = used
      this.batches++
      this.barrier()
      for (let source = 0; source < workers; source++) {
        const queue = source * workers + owner
        const count = this.input.messageCounts[queue]!
        for (let index = 0; index < count; index++) {
          const offset = (queue * this.input.capacity + index) * 2
          const target = this.input.messageIds[offset]!,
            g = this.input.messageCosts[offset]!
          if (g >= this.best[target]!) continue
          this.setCandidateBestCost(target, g)
          const port = Math.floor(target / this.candidateHopSlotStride)
          const region =
            topology.incidentPortRegion[port]![
              target % this.candidateHopSlotStride
            ]!
          const h = this.input.messageCosts[offset + 1]!
          this.enqueue({
            hopId: target,
            portId: port,
            nextRegionId: region,
            g,
            h,
            f: g + h,
            parentHop: this.input.messageIds[offset + 1]!,
          })
        }
      }
      this.publish()
      this.barrier()
      this.finishRound()
      this.barrier()
    }
    this.input.counters[owner * 4] += this.iterations
    this.input.counters[owner * 4 + 1] += this.messages
    this.input.counters[owner * 4 + 2] += this.relaxations
    this.input.counters[owner * 4 + 3] += this.batches
  }
}

export class DistributedSearchTask {
  static readonly solverName = "DistributedSearchTask"
  constructor(private readonly input: DistributedSearchInput) {}
  solve(): void {
    const c = this.input.control,
      C = SEARCH_CONTROL
    try {
      const solver = new DistributedSolver(this.input)
      solver.setup()
      let previous = 0
      Atomics.add(c, C.ready, 1)
      Atomics.notify(c, C.ready)
      while (!Atomics.load(c, C.stop)) {
        const query = Atomics.load(c, C.query)
        if (query === previous) {
          Atomics.wait(c, C.query, query, 100)
          continue
        }
        previous = query
        if (Atomics.load(c, C.stop)) break
        solver.search()
        Atomics.add(c, C.done, 1)
        Atomics.notify(c, C.done)
      }
    } catch (error) {
      Atomics.store(c, C.error, 1)
      for (const index of [C.ready, C.done, C.barrierEpoch])
        Atomics.notify(c, index)
      throw error
    }
  }
  getOutput(): Record<string, never> {
    return {}
  }
}

export class DistributedSearchReadyTask {
  static readonly solverName = "DistributedSearchReadyTask"
  constructor(_input: Record<string, never>) {}
  solve(): void {}
  getOutput(): Record<string, never> {
    return {}
  }
}
