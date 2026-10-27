import type { Candidate } from "../core"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type PartialRouteSearchStats,
} from "../outside-in-partial-rip-tiny-hypergraph-solver"

/** The original bounded two-ended search, detached from route commits. */
export class PartialRouteSearchSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  readonly regions = new Set<number>()
  candidate?: Candidate
  exhausted = false
  private completedOutsideIn = false
  private observe?: (region: number) => boolean

  private read(region: number): boolean {
    if (this.regions.has(region)) return true
    this.regions.add(region)
    if (!this.observe || this.observe(region)) return true
    this.solved = true
    return false
  }

  override isRegionReservedForDifferentNet(region: number): boolean {
    return !this.read(region) || super.isRegionReservedForDifferentNet(region)
  }

  override computeG(
    candidate: Candidate,
    neighbor: number,
    maximum = Infinity,
    distance?: number,
  ): number {
    return this.read(candidate.nextRegionId)
      ? super.computeG(candidate, neighbor, maximum, distance)
      : Infinity
  }

  override onPathFound(candidate: Candidate): void {
    if (candidate.portId !== this.state.goalPortId) {
      super.onPathFound(candidate)
      return
    }
    this.completedOutsideIn =
      this.outsideInRouteSearch?.routeId === this.state.currentRouteId
    this.candidate = candidate
    this.solved = true
  }

  override onOutOfCandidates(): void {
    this.exhausted = true
    this.solved = true
  }

  override tryFinalAcceptance(): void {}

  override _step(): void {
    super._step()
    if (this.failed)
      throw new Error(this.error ?? "Detached partial search failed")
  }

  search(
    routeId: number,
    budget: number,
    control: Int32Array,
    plan: Float64Array,
    observe?: (region: number) => boolean,
  ): void {
    this.candidate = undefined
    this.exhausted = false
    this.completedOutsideIn = false
    this.regions.clear()
    this.observe = observe
    this.outsideInRouteSearch = undefined
    this.oneSidedFallbackRouteId = plan[8]! < 0 ? undefined : plan[8]!
    this.partialRipRoutePlans.clear()
    this.PARTIAL_RIP_ENABLED = plan[9] === 1
    this.OUTSIDE_IN_ROUTING = plan[10] === 1
    this.OUTSIDE_IN_MAX_DISTANCE = plan[11]!
    this.partialRipRoutePlans.set(routeId, {
      routeId,
      activeStartPortId: plan[1]!,
      activeEndPortId: plan[2]!,
      forcedStartRegionId: plan[3]!,
      forcedEndRegionId: plan[4]!,
      rippedSegmentCount: plan[5]!,
      retainedSegmentCount: plan[6]!,
    })
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.goalPortId = -1
    this.state.unroutedRoutes = [routeId]
    this.state.ripCount = plan[7]!
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.routeAttemptCountByRouteId[routeId] = 0
    this.outsideInRouteCount =
      this.outsideInCompletedRouteCount =
      this.outsideInFallbackRouteCount =
        0
    this.outsideInForwardExpansionCount =
      this.outsideInReverseExpansionCount =
      this.outsideInDistancePruneCount =
        0
    this.iterations = 0
    this.MAX_ITERATIONS = budget
    this.solved = this.failed = false
    this.error = null
    for (const port of [plan[1]!, plan[2]!])
      for (const region of this.topology.incidentPortRegion[port]!)
        this.read(region)
    while (!this.solved && !this.failed && this.iterations < budget) {
      if (Atomics.load(control, 0) === 3 || Atomics.load(control, 9)) break
      this.step()
    }
    if (this.failed && this.iterations < budget)
      throw new Error(this.error ?? "Detached partial search failed")
  }

  getSearchStats(route: number): PartialRouteSearchStats {
    return {
      routes: this.outsideInRouteCount,
      completed:
        this.outsideInCompletedRouteCount + (this.completedOutsideIn ? 1 : 0),
      fallbacks: this.outsideInFallbackRouteCount,
      forward: this.outsideInForwardExpansionCount,
      reverse: this.outsideInReverseExpansionCount,
      pruned: this.outsideInDistancePruneCount,
      attempts: this.routeAttemptCountByRouteId[route]!,
      oneSidedFallbackRouteId: this.oneSidedFallbackRouteId,
    }
  }
}
