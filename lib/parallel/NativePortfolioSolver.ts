import {
  TinyHyperGraphSolver,
  createEmptyRegionIntersectionCache,
  type Candidate,
} from "../core"
import { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"
import { NativeRouteSearch } from "./NativeRouteSearch"
import { setNewIntersectionCounts } from "../countNewIntersections"
import { shuffle } from "../shuffle"
import { range } from "../utils"

/** The existing solver owns route order, commits, rerips and acceptance.
 * Only the immutable A* search is batched into the bounded WASM kernel. */
export class NativePortfolioSolver extends TinyHyperGraphSolver {
  private native?: NativeRouteSearch
  private readonly emptyCache = createEmptyRegionIntersectionCache()
  private buffers: Array<
    | {
        net: Int32Array
        less: Int32Array
        greater: Int32Array
        mask: Int32Array
      }
    | undefined
  > = []
  override getSolverName() {
    return this.ADD_SEGMENT_DISTANCE_TO_G
      ? "DistanceAwareTinyHyperGraphSolver"
      : "TinyHyperGraphSolver"
  }
  override _setup() {
    if (this.ADD_SEGMENT_DISTANCE_TO_G)
      DistanceAwareTinyHyperGraphSolver.prototype._setup.call(this)
    else super._setup()
    if (this.failed || this.solved || !NativeRouteSearch.supports(this)) return
    this.native = new NativeRouteSearch(this, this.ADD_SEGMENT_DISTANCE_TO_G)
    this.state.portAssignment = this.native.assignments
    this.state.regionCongestionCost = this.native.congestion
  }
  override onPathFound(candidate: Candidate) {
    if (this.ADD_SEGMENT_DISTANCE_TO_G)
      DistanceAwareTinyHyperGraphSolver.prototype.onPathFound.call(
        this,
        candidate,
      )
    else super.onPathFound(candidate)
  }
  override appendSegmentToRegionCache(
    region: number,
    from: number,
    to: number,
  ) {
    if (!this.buffers) {
      super.appendSegmentToRegionCache(region, from, to)
      return
    }
    const old = this.state.regionIntersectionCaches[region]
    const geometry = this.populateSegmentGeometryScratch(region, from, to)
    setNewIntersectionCounts(old, geometry)
    const count = old.existingSegmentCount,
      next = count + 1
    let buffer = this.buffers[region]
    if (!buffer || buffer.net.length < next) {
      let capacity = 4
      while (capacity < next) capacity *= 2
      buffer = {
        net: new Int32Array(capacity),
        less: new Int32Array(capacity),
        greater: new Int32Array(capacity),
        mask: new Int32Array(capacity),
      }
      buffer.net.set(old.netIds)
      buffer.less.set(old.lesserAngles)
      buffer.greater.set(old.greaterAngles)
      buffer.mask.set(old.layerMasks)
      this.buffers[region] = buffer
    }
    buffer.net[count] = this.state.currentRouteNetId!
    buffer.less[count] = geometry.lesserAngle
    buffer.greater[count] = geometry.greaterAngle
    buffer.mask[count] = geometry.layerMask
    const same =
      old.existingSameLayerIntersections + geometry.sameLayerIntersectionCount
    const cross =
      old.existingCrossingLayerIntersections +
      geometry.crossingLayerIntersectionCount
    const changes =
      old.existingEntryExitLayerChanges + geometry.entryExitLayerChanges
    this.state.regionIntersectionCaches[region] = {
      netIds: buffer.net.subarray(0, next),
      lesserAngles: buffer.less.subarray(0, next),
      greaterAngles: buffer.greater.subarray(0, next),
      layerMasks: buffer.mask.subarray(0, next),
      existingSameLayerIntersections: same,
      existingCrossingLayerIntersections: cross,
      existingEntryExitLayerChanges: changes,
      existingSegmentCount: next,
      existingRegionCost: this.computeRegionCostForRegion(
        region,
        same,
        cross,
        changes,
        next,
      ),
    }
    if (this.native && !this.native.append(region)) this.native = undefined
  }
  override resetRoutingStateForRerip() {
    const { state, problem } = this
    state.portAssignment.fill(-1)
    for (const segments of state.regionSegments) segments.length = 0
    state.regionIntersectionCaches.fill(this.emptyCache)
    state.currentRouteId = undefined
    state.currentRouteNetId = undefined
    state.unroutedRoutes = shuffle(range(problem.routeCount), state.ripCount)
    state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    state.goalPortId = -1
    this.native?.reset()
  }
  override _step() {
    if (
      !this.native ||
      this.state.currentRouteId !== undefined ||
      !this.state.unroutedRoutes.length
    )
      return super._step()
    const route = this.state.unroutedRoutes.shift()!
    this.state.currentRouteId = route
    this.state.currentRouteNetId = this.problem.routeNet[route]
    this.routeAttemptCountByRouteId[route]++
    this.resetCandidateBestCosts()
    this.state.candidateQueue.clear()
    const start = this.getRouteStartPortId(route),
      region = this.getStartingNextRegionId(route, start)
    if (region === undefined) {
      this.failed = true
      this.error = `Start port ${start} has no incident regions`
      return
    }
    this.setCandidateBestCost(this.getHopId(start, region), 0)
    this.state.goalPortId = this.problem.routeEndPort[route]
    const result = this.native.search(
      route,
      start,
      region,
      this.MAX_ITERATIONS - this.iterations + 1,
    )
    if (result.overflow) {
      // Restart this unchanged search in JS without charging the abandoned
      // attempt to the logical budget. No routing mutation has occurred.
      this.native = undefined
      this.routeAttemptCountByRouteId[route]--
      this.state.currentRouteId = undefined
      this.state.currentRouteNetId = undefined
      this.state.unroutedRoutes.unshift(route)
      return super._step()
    }
    this.iterations += result.steps - 1
    if (result.candidate)
      TinyHyperGraphSolver.prototype.onPathFound.call(this, result.candidate)
    else if (result.exhausted)
      TinyHyperGraphSolver.prototype.onOutOfCandidates.call(this)
  }
}
