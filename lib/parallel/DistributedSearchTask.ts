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
  result: 7,
  goal: 8,
  pause: 9,
  stopped: 10,
  paused: 11,
  event: 12,
  goalVersion: 13,
  pauseEpoch: 14,
  tokens: 32,
} as const
export type DistributedSearchInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  context: SharedRouteContext
  control: Int32Array
  published: Float64Array
  labelVersions: Int32Array
  parents: Int32Array
  bounds: Float64Array
  activity: Int32Array
  wake: Int32Array
  heads: Int32Array
  tails: Int32Array
  messageIds: Int32Array
  messageCosts: Float64Array
  counters: Float64Array
  owner: number
  workers: number
  capacity: number
  batchSize: number
  hops: number
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
  override isClosedHopId(hop: number): boolean {
    return this.solver.input.workers === 1 ? super.isClosedHopId(hop) : false
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
  readonly versions: Int32Array
  private readonly remoteCosts: Float64Array
  private readonly remoteStamps: Uint32Array
  private remoteGeneration = 1
  heap!: DistributedHeap
  goalBest = Infinity
  goalFirst = 0
  goalLast = 0
  messages = 0
  relaxations = 0
  batches = 0

  constructor(readonly input: DistributedSearchInput) {
    super(input.topology, input.problem, {
      ...input.options,
      STATIC_REACHABILITY_PRECHECK: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      MAX_ITERATIONS: Infinity,
      VERBOSE: false,
    })
    this.best = new Float64Array(input.hops)
    this.sent = new Float64Array(input.hops)
    this.versions = new Int32Array(input.topology.regionCount).fill(-1)
    this.remoteCosts = new Float64Array(input.hops)
    this.remoteStamps = new Uint32Array(input.hops)
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
    const owner = this.owner(hop)
    if (owner === this.input.owner) return this.best[hop]!
    if (this.remoteStamps[hop] === this.remoteGeneration)
      return Math.min(this.remoteCosts[hop]!, this.sent[hop]!)
    const offset = owner * this.input.hops + hop
    const version = Atomics.load(this.input.labelVersions, offset)
    this.remoteStamps[hop] = this.remoteGeneration
    if (version & 1) {
      this.remoteCosts[hop] = Infinity
      return this.sent[hop]!
    }
    const value = this.input.published[offset]!
    // A concurrent update may tear a Float64. Reject that sample rather than
    // using it to prune; the sender's own bound is always a valid path cost.
    this.remoteCosts[hop] =
      version === Atomics.load(this.input.labelVersions, offset)
        ? value
        : Infinity
    return Math.min(this.remoteCosts[hop]!, this.sent[hop]!)
  }
  override setCandidateBestCost(hop: number, value: number): void {
    if (this.owner(hop) !== this.input.owner) {
      this.sent[hop] = value
      return
    }
    this.best[hop] = value
    const offset = this.input.owner * this.input.hops + hop
    Atomics.add(this.input.labelVersions, offset, 1)
    this.input.published[offset] = value
    Atomics.add(this.input.labelVersions, offset, 1)
  }
  private signal(): void {
    Atomics.add(this.input.control, SEARCH_CONTROL.event, 1)
    Atomics.notify(this.input.control, SEARCH_CONTROL.event)
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
      this.input.parents[destination * this.input.hops + hop] = parent
      candidate.hopId = hop
      candidate.prevCandidate = undefined
      this.heap.queueLocal(candidate)
      if (
        candidate.portId === this.state.goalPortId &&
        candidate.g < this.goalBest
      ) {
        this.goalBest = candidate.g
        const c = this.input.control,
          C = SEARCH_CONTROL
        Atomics.add(c, C.goalVersion, 1)
        this.input.bounds[this.input.workers * 8] = candidate.g
        c[C.goal] = hop
        Atomics.add(c, C.goalVersion, 1)
        this.signal()
      }
      this.relaxations++
      return
    }
    const queue = this.input.owner * this.input.workers + destination,
      index = queue * 16
    const tail = Atomics.load(this.input.tails, index)
    while (
      tail - Atomics.load(this.input.heads, index) >=
      this.input.capacity
    ) {
      this.checkFailure()
      this.drain()
      const head = Atomics.load(this.input.heads, index)
      if (tail - head >= this.input.capacity)
        Atomics.wait(this.input.heads, index, head, 1)
    }
    const offset =
      (queue * this.input.capacity + (tail % this.input.capacity)) * 2
    this.input.messageIds[offset] = hop
    this.input.messageIds[offset + 1] = parent
    this.input.messageCosts[offset] = candidate.g
    this.input.messageCosts[offset + 1] = candidate.h
    // Payload publication and slot reuse use release/acquire operations.
    Atomics.store(this.input.tails, index, tail + 1)
    if (Atomics.load(this.input.activity, destination * 16) === 0) {
      Atomics.add(this.input.wake, destination * 16, 1)
      Atomics.notify(this.input.wake, destination * 16)
    }
    this.messages++
  }
  private drain(): void {
    for (let source = 0; source < this.input.workers; source++) {
      const queue = source * this.input.workers + this.input.owner,
        index = queue * 16
      let head = Atomics.load(this.input.heads, index)
      const tail = Atomics.load(this.input.tails, index)
      for (; head < tail; head++) {
        const offset =
          (queue * this.input.capacity + (head % this.input.capacity)) * 2
        const hop = this.input.messageIds[offset]!,
          g = this.input.messageCosts[offset]!
        if (g >= this.best[hop]!) continue
        this.setCandidateBestCost(hop, g)
        const port = Math.floor(hop / this.candidateHopSlotStride),
          region =
            this.topology.incidentPortRegion[port]![
              hop % this.candidateHopSlotStride
            ]!
        const h = this.input.messageCosts[offset + 1]!
        this.enqueue({
          hopId: hop,
          portId: port,
          nextRegionId: region,
          g,
          h,
          f: g + h,
          parentHop: this.input.messageIds[offset + 1]!,
        })
      }
      Atomics.store(this.input.heads, index, head)
      Atomics.notify(this.input.heads, index)
    }
  }
  private hasMessages(): boolean {
    for (let source = 0; source < this.input.workers; source++) {
      const index = (source * this.input.workers + this.input.owner) * 16
      if (
        Atomics.load(this.input.heads, index) !==
        Atomics.load(this.input.tails, index)
      )
        return true
    }
    return false
  }
  private goalBound(): number {
    const c = this.input.control,
      C = SEARCH_CONTROL
    const version = Atomics.load(c, C.goalVersion)
    if (version & 1) return Infinity
    const bound = this.input.bounds[this.input.workers * 8]!
    return version === Atomics.load(c, C.goalVersion) ? bound : Infinity
  }

  private publishFrontier(): void {
    const index = this.input.owner * 16 + 1
    const previous = this.input.bounds[this.input.owner * 8]!
    const next = this.heap.peek()?.f ?? Infinity
    Atomics.add(this.input.activity, index, 1)
    this.input.bounds[this.input.owner * 8] = next
    Atomics.add(this.input.activity, index, 1)
    if (next > previous) {
      for (let owner = 0; owner < this.input.workers; owner++) {
        if (Atomics.load(this.input.activity, owner * 16) !== 0) continue
        Atomics.add(this.input.wake, owner * 16, 1)
        Atomics.notify(this.input.wake, owner * 16)
      }
    }
  }

  private schedulingBound(): number {
    let minimum = this.heap.peek()?.f ?? Infinity
    for (let owner = 0; owner < this.input.workers; owner++) {
      if (owner === this.input.owner) continue
      const index = owner * 16 + 1
      const version = Atomics.load(this.input.activity, index)
      if (version & 1) continue
      const value = this.input.bounds[owner * 8]!
      if (version === Atomics.load(this.input.activity, index))
        minimum = Math.min(minimum, value)
    }
    return minimum + Math.max(1e-9, this.DISTANCE_TO_COST)
  }
  override onPathFound(candidate: Candidate): void {
    if (candidate.portId !== this.state.goalPortId) super.onPathFound(candidate)
  }
  override onOutOfCandidates(): void {}
  override tryFinalAcceptance(): void {}
  private checkFailure(): void {
    if (
      Atomics.load(this.input.control, SEARCH_CONTROL.stop) ||
      Atomics.load(this.input.control, SEARCH_CONTROL.error)
    )
      throw new Error("Distributed search aborted")
  }
  private pause(): void {
    const c = this.input.control,
      C = SEARCH_CONTROL
    const epoch = Atomics.load(c, C.pauseEpoch)
    // Stop expansion first, while still draining incoming rings so a sender
    // finishing its current expansion cannot deadlock on a full channel.
    Atomics.add(c, C.stopped, 1)
    Atomics.notify(c, C.stopped)
    while (Atomics.load(c, C.stopped) !== this.input.workers) {
      this.checkFailure()
      this.drain()
      const count = Atomics.load(c, C.stopped)
      if (count !== this.input.workers) Atomics.wait(c, C.stopped, count, 1)
    }
    this.drain()
    this.input.bounds[this.input.owner * 8] = this.heap.peek()?.f ?? Infinity
    Atomics.add(c, C.paused, 1)
    Atomics.notify(c, C.paused)
    while (Atomics.load(c, C.pauseEpoch) === epoch) {
      this.checkFailure()
      Atomics.wait(c, C.pauseEpoch, epoch, 100)
    }
  }
  search(): void {
    const { control: c, context, topology, owner, workers } = this.input,
      C = SEARCH_CONTROL
    this.best.fill(Infinity)
    this.sent.fill(Infinity)
    this.remoteStamps.fill(0)
    this.remoteGeneration = 1
    this.heap.clear()
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.messages = 0
    this.relaxations = 0
    this.batches = 0
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
    while (!c[C.result]) {
      this.checkFailure()
      if (Atomics.load(c, C.pause)) {
        this.pause()
        continue
      }
      Atomics.store(this.input.activity, owner * 16, 1)
      if (++this.remoteGeneration === 0xffffffff) {
        this.remoteStamps.fill(0)
        this.remoteGeneration = 1
      }
      this.drain()
      this.publishFrontier()
      const goal = this.goalBound()
      const cutoff = this.schedulingBound()
      let used = 0
      while (used < this.input.batchSize) {
        const candidate = this.heap.peek()
        if (
          !candidate ||
          candidate.f > cutoff ||
          candidate.f >= (owner === 0 ? this.goalBest : goal)
        )
          break
        if (Atomics.add(c, C.tokens, 1) >= c[C.budget]!) break
        this.step()
        used++
      }
      this.batches++
      this.publishFrontier()
      if (used === this.input.batchSize) continue
      const epoch = Atomics.load(this.input.wake, owner * 16)
      Atomics.store(this.input.activity, owner * 16, 0)
      this.signal()
      if (this.hasMessages() || Atomics.load(c, C.pause)) continue
      const candidate = this.heap.peek()
      if (
        candidate &&
        candidate.f < this.goalBound() &&
        candidate.f <= this.schedulingBound() &&
        Atomics.load(c, C.tokens) < c[C.budget]!
      )
        continue
      Atomics.wait(this.input.wake, owner * 16, epoch, 100)
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
      for (const index of [C.ready, C.done, C.paused, C.stopped, C.event])
        Atomics.notify(c, index)
      throw error
    }
  }
  getOutput(): Record<string, never> {
    return {}
  }
}
