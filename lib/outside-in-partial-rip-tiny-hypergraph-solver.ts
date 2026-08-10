import {
  type Candidate,
  createEmptyRegionIntersectionCache,
  type RegionCostSummary,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { DistanceAwareTinyHyperGraphSolver } from "./distance-aware-tiny-hypergraph-solver"
import { MinHeap } from "./MinHeap"
import type { PortId, RegionId, RouteId } from "./types"

type CommittedRouteSegment = {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

type PartialRipRoutePlan = {
  routeId: RouteId
  activeStartPortId: PortId
  activeEndPortId: PortId
  forcedStartRegionId: RegionId
  forcedEndRegionId: RegionId
  rippedSegmentCount: number
  retainedSegmentCount: number
}

type OutsideInCandidate = Candidate & {
  travelDistance: number
}

type OutsideInFrontier = {
  queue: MinHeap<OutsideInCandidate>
  bestCostByHopId: Map<number, number>
  settledByPortId: Map<PortId, OutsideInCandidate>
  settledByRegionId: Map<RegionId, OutsideInCandidate[]>
  targetPortId: PortId
}

type OutsideInRouteSearch = {
  routeId: RouteId
  forward: OutsideInFrontier
  reverse: OutsideInFrontier
  expandForwardNext: boolean
  distanceLimitHit: boolean
  bestJoinedCandidate?: Candidate
  bestJoinedCost: number
  remainingPostMeetingExpansions?: number
}

type JoinedOutsideInCandidate = {
  candidate: Candidate
  cost: number
}

type IndexedCommittedRouteSegment = CommittedRouteSegment & {
  segmentIndex: number
}

/**
 * Retains the two outside portions of a completed route and only reroutes a
 * bounded window around a congested region. The active window is represented
 * as a normal route with temporary endpoints, so all existing cost and hard
 * constraint checks continue to apply.
 *
 * Outside-in frontier search is implemented by this class separately from the
 * partial-rip state transition. Initial whole routes retain the established
 * one-ended search; the bounded two-ended search applies to reopened spans.
 */
export class OutsideInPartialRipTinyHyperGraphSolver extends DistanceAwareTinyHyperGraphSolver {
  protected partialRipRoutePlans = new Map<RouteId, PartialRipRoutePlan>()
  private outsideInRouteSearch?: OutsideInRouteSearch
  private oneSidedFallbackRouteId?: RouteId
  private partialRipWindowDistance?: number
  private partialRipCount = 0
  private partiallyRippedRouteCount = 0
  private partiallyRippedSegmentCount = 0
  private retainedPartialRipSegmentCount = 0
  private outsideInRouteCount = 0
  private outsideInCompletedRouteCount = 0
  private outsideInFallbackRouteCount = 0
  private outsideInForwardExpansionCount = 0
  private outsideInReverseExpansionCount = 0
  private outsideInDistancePruneCount = 0

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    if (options?.PARTIAL_RIP_ENABLED === undefined) {
      this.PARTIAL_RIP_ENABLED = true
    }
    if (options?.OUTSIDE_IN_ROUTING === undefined) {
      this.OUTSIDE_IN_ROUTING = true
    }
    if (
      this.PARTIAL_RIP_ENABLED &&
      options?.PARTIAL_RIP_MAX_ATTEMPTS === undefined
    ) {
      this.PARTIAL_RIP_MAX_ATTEMPTS = 10
    }
  }

  protected override getRouteStartPortId(routeId: RouteId): PortId {
    return (
      this.partialRipRoutePlans.get(routeId)?.activeStartPortId ??
      super.getRouteStartPortId(routeId)
    )
  }

  protected override getRouteEndPortId(routeId: RouteId): PortId {
    return (
      this.partialRipRoutePlans.get(routeId)?.activeEndPortId ??
      super.getRouteEndPortId(routeId)
    )
  }

  override getStartingNextRegionId(
    routeId: RouteId,
    startingPortId: PortId,
  ): RegionId | undefined {
    const partialRipRoutePlan = this.partialRipRoutePlans.get(routeId)
    if (
      partialRipRoutePlan &&
      partialRipRoutePlan.activeStartPortId === startingPortId
    ) {
      return partialRipRoutePlan.forcedStartRegionId
    }

    return super.getStartingNextRegionId(routeId, startingPortId)
  }

  private getEndingNextRegionId(
    routeId: RouteId,
    endingPortId: PortId,
  ): RegionId | undefined {
    const partialRipRoutePlan = this.partialRipRoutePlans.get(routeId)
    if (
      partialRipRoutePlan &&
      partialRipRoutePlan.activeEndPortId === endingPortId
    ) {
      return partialRipRoutePlan.forcedEndRegionId
    }

    return super.getStartingNextRegionId(routeId, endingPortId)
  }

  override computeH(neighborPortId: PortId): number {
    const routeId = this.state.currentRouteId
    if (routeId === undefined || !this.partialRipRoutePlans.has(routeId)) {
      return super.computeH(neighborPortId)
    }

    const endPortId = this.getRouteEndPortId(routeId)
    return (
      Math.hypot(
        this.topology.portX[neighborPortId]! - this.topology.portX[endPortId]!,
        this.topology.portY[neighborPortId]! - this.topology.portY[endPortId]!,
      ) * this.DISTANCE_TO_COST
    )
  }

  override onPathFound(finalCandidate: Candidate): void {
    const routeId = this.state.currentRouteId
    const completedOutsideInRoute =
      routeId !== undefined && this.outsideInRouteSearch?.routeId === routeId
    super.onPathFound(finalCandidate)
    if (routeId !== undefined && this.state.currentRouteId === undefined) {
      this.partialRipRoutePlans.delete(routeId)
      if (completedOutsideInRoute) this.outsideInCompletedRouteCount += 1
      if (this.oneSidedFallbackRouteId === routeId) {
        this.oneSidedFallbackRouteId = undefined
      }
    }
    this.outsideInRouteSearch = undefined
    this.publishOutsideInStats()
  }

  override resetRoutingStateForRerip(): void {
    this.partialRipRoutePlans.clear()
    this.outsideInRouteSearch = undefined
    this.oneSidedFallbackRouteId = undefined
    super.resetRoutingStateForRerip()
  }

  protected clearPartialRipPlans(routeIds: ReadonlySet<RouteId>): void {
    for (const routeId of routeIds) {
      this.partialRipRoutePlans.delete(routeId)
    }
  }

  private getCommittedRouteSegments(
    routeId: RouteId,
  ): CommittedRouteSegment[] | undefined {
    const indexedSegments: IndexedCommittedRouteSegment[] = []
    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      for (const [segmentRouteId, fromPortId, toPortId] of this.state
        .regionSegments[regionId] ?? []) {
        if (segmentRouteId !== routeId) continue
        indexedSegments.push({
          segmentIndex: indexedSegments.length,
          regionId,
          fromPortId,
          toPortId,
        })
      }
    }

    if (indexedSegments.length === 0) return undefined

    const segmentIndicesByPortId = new Map<PortId, number[]>()
    for (const segment of indexedSegments) {
      for (const portId of [segment.fromPortId, segment.toPortId]) {
        const segmentIndices = segmentIndicesByPortId.get(portId) ?? []
        segmentIndices.push(segment.segmentIndex)
        segmentIndicesByPortId.set(portId, segmentIndices)
      }
    }

    const endPortId = this.problem.routeEndPort[routeId]!
    const orderedSegments: CommittedRouteSegment[] = []
    const usedSegmentIndices = new Set<number>()
    const visitedPortIds = new Set<PortId>([
      this.problem.routeStartPort[routeId]!,
    ])

    const appendPathToEnd = (portId: PortId): boolean => {
      if (portId === endPortId) return true

      for (const segmentIndex of segmentIndicesByPortId.get(portId) ?? []) {
        if (usedSegmentIndices.has(segmentIndex)) continue
        const segment = indexedSegments[segmentIndex]!
        const nextPortId =
          segment.fromPortId === portId ? segment.toPortId : segment.fromPortId
        if (visitedPortIds.has(nextPortId)) continue

        usedSegmentIndices.add(segmentIndex)
        visitedPortIds.add(nextPortId)
        orderedSegments.push({
          regionId: segment.regionId,
          fromPortId: portId,
          toPortId: nextPortId,
        })

        if (appendPathToEnd(nextPortId)) return true

        orderedSegments.pop()
        visitedPortIds.delete(nextPortId)
        usedSegmentIndices.delete(segmentIndex)
      }

      return false
    }

    if (
      !appendPathToEnd(this.problem.routeStartPort[routeId]!) ||
      usedSegmentIndices.size !== indexedSegments.length
    ) {
      return undefined
    }

    return orderedSegments
  }

  private getSegmentDistance(segment: CommittedRouteSegment): number {
    return Math.hypot(
      this.topology.portX[segment.fromPortId]! -
        this.topology.portX[segment.toPortId]!,
      this.topology.portY[segment.fromPortId]! -
        this.topology.portY[segment.toPortId]!,
    )
  }

  private getPartialRipWindow(
    orderedSegments: readonly CommittedRouteSegment[],
    hotRegionIds: ReadonlySet<RegionId>,
    regionCosts: Float64Array,
  ): { startIndex: number; endIndex: number } | undefined {
    let hottestSegmentIndex: number | undefined
    let hottestSegmentCost = Number.NEGATIVE_INFINITY

    for (
      let segmentIndex = 0;
      segmentIndex < orderedSegments.length;
      segmentIndex++
    ) {
      const segment = orderedSegments[segmentIndex]!
      if (!hotRegionIds.has(segment.regionId)) continue
      const regionCost = regionCosts[segment.regionId] ?? 0
      if (regionCost > hottestSegmentCost) {
        hottestSegmentCost = regionCost
        hottestSegmentIndex = segmentIndex
      }
    }

    if (hottestSegmentIndex === undefined) return undefined

    const maxDistance = Math.max(
      0,
      this.partialRipWindowDistance ?? this.PARTIAL_RIP_MAX_DISTANCE,
    )
    let startIndex = hottestSegmentIndex
    let endIndex = hottestSegmentIndex
    let startDistance =
      this.getSegmentDistance(orderedSegments[hottestSegmentIndex]!) / 2
    let endDistance = startDistance

    while (startIndex > 0) {
      const nextDistance = this.getSegmentDistance(
        orderedSegments[startIndex - 1]!,
      )
      if (startDistance + nextDistance > maxDistance) break
      startIndex -= 1
      startDistance += nextDistance
    }

    while (endIndex + 1 < orderedSegments.length) {
      const nextDistance = this.getSegmentDistance(
        orderedSegments[endIndex + 1]!,
      )
      if (endDistance + nextDistance > maxDistance) break
      endIndex += 1
      endDistance += nextDistance
    }

    return { startIndex, endIndex }
  }

  private appendRetainedSegment(
    retainedSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
    routeId: RouteId,
    segment: CommittedRouteSegment,
  ): void {
    retainedSegmentsByRegion[segment.regionId]!.push([
      routeId,
      segment.fromPortId,
      segment.toPortId,
    ])
  }

  protected preparePartialRip(
    hotRegionIds: readonly RegionId[],
    regionCosts: Float64Array,
  ): boolean {
    if (!this.PARTIAL_RIP_ENABLED || hotRegionIds.length === 0) return false

    const hotRegionIdSet = new Set(hotRegionIds)
    if (this.partialRipWindowDistance === undefined) {
      // A near-target solution usually has one stubborn local minimum. Give
      // that run more topology to work with, and latch the choice so window
      // sizes do not oscillate as congestion changes between rounds.
      let maxHotRegionCost = 0
      for (const regionId of hotRegionIds) {
        maxHotRegionCost = Math.max(
          maxHotRegionCost,
          regionCosts[regionId] ?? 0,
        )
      }
      const baseDistance = Math.max(0, this.PARTIAL_RIP_MAX_DISTANCE)
      const qualityDistance = Math.max(
        baseDistance,
        this.PARTIAL_RIP_QUALITY_MAX_DISTANCE ?? baseDistance * 2,
      )
      this.partialRipWindowDistance =
        maxHotRegionCost <= this.RIP_THRESHOLD_END * 1.5
          ? qualityDistance
          : baseDistance
    }
    const routeIdsTouchingHotRegions = new Set<RouteId>()
    for (const regionId of hotRegionIds) {
      for (const [routeId] of this.state.regionSegments[regionId] ?? []) {
        routeIdsTouchingHotRegions.add(routeId)
      }
    }
    if (routeIdsTouchingHotRegions.size === 0) return false

    const retainedSegmentsByRegion = Array.from(
      { length: this.topology.regionCount },
      () => [] as [RouteId, PortId, PortId][],
    )
    const nextPlans = new Map<RouteId, PartialRipRoutePlan>()
    let rippedSegmentCount = 0
    let retainedSegmentCount = 0

    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const orderedSegments = this.getCommittedRouteSegments(routeId)
      if (!orderedSegments) return false

      if (!routeIdsTouchingHotRegions.has(routeId)) {
        for (const segment of orderedSegments) {
          this.appendRetainedSegment(retainedSegmentsByRegion, routeId, segment)
          retainedSegmentCount += 1
        }
        continue
      }

      const window = this.getPartialRipWindow(
        orderedSegments,
        hotRegionIdSet,
        regionCosts,
      )
      if (!window) return false

      for (
        let segmentIndex = 0;
        segmentIndex < orderedSegments.length;
        segmentIndex++
      ) {
        const segment = orderedSegments[segmentIndex]!
        if (
          segmentIndex >= window.startIndex &&
          segmentIndex <= window.endIndex
        ) {
          rippedSegmentCount += 1
          continue
        }
        this.appendRetainedSegment(retainedSegmentsByRegion, routeId, segment)
        retainedSegmentCount += 1
      }

      const firstRippedSegment = orderedSegments[window.startIndex]!
      const lastRippedSegment = orderedSegments[window.endIndex]!
      nextPlans.set(routeId, {
        routeId,
        activeStartPortId: firstRippedSegment.fromPortId,
        activeEndPortId: lastRippedSegment.toPortId,
        forcedStartRegionId: firstRippedSegment.regionId,
        forcedEndRegionId: lastRippedSegment.regionId,
        rippedSegmentCount: window.endIndex - window.startIndex + 1,
        retainedSegmentCount:
          orderedSegments.length - (window.endIndex - window.startIndex + 1),
      })
    }

    if (nextPlans.size === 0 || rippedSegmentCount === 0) return false

    this.partialRipRoutePlans = nextPlans
    this.rebuildRetainedRoutingState(retainedSegmentsByRegion, [
      ...nextPlans.keys(),
    ])
    this.partialRipCount += 1
    this.partiallyRippedRouteCount += nextPlans.size
    this.partiallyRippedSegmentCount += rippedSegmentCount
    this.retainedPartialRipSegmentCount += retainedSegmentCount
    this.publishPartialRipStats()
    return true
  }

  private rebuildRetainedRoutingState(
    retainedSegmentsByRegion: Array<[RouteId, PortId, PortId][]>,
    unroutedRouteIds: RouteId[],
  ): void {
    this.state.portAssignment.fill(-1)
    this.state.regionSegments = Array.from(
      { length: this.topology.regionCount },
      () => [],
    )
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = unroutedRouteIds
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = -1
    this.outsideInRouteSearch = undefined
    this.oneSidedFallbackRouteId = undefined

    for (
      let regionId = 0;
      regionId < retainedSegmentsByRegion.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of retainedSegmentsByRegion[
        regionId
      ] ?? []) {
        const routeNetId = this.problem.routeNet[routeId]!
        this.state.currentRouteNetId = routeNetId
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            throw new Error(
              `OutsideInPartialRipTinyHyperGraphSolver: retained port ${portId} belongs to multiple nets`,
            )
          }
          this.state.portAssignment[portId] = routeNetId
        }
        this.state.regionSegments[regionId]!.push([
          routeId,
          fromPortId,
          toPortId,
        ])
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  private publishPartialRipStats(): void {
    this.stats = {
      ...this.stats,
      partialRipCount: this.partialRipCount,
      partiallyRippedRouteCount: this.partiallyRippedRouteCount,
      partiallyRippedSegmentCount: this.partiallyRippedSegmentCount,
      retainedPartialRipSegmentCount: this.retainedPartialRipSegmentCount,
      partialRipMaxDistance:
        this.partialRipWindowDistance ?? this.PARTIAL_RIP_MAX_DISTANCE,
      partialRipBaseMaxDistance: this.PARTIAL_RIP_MAX_DISTANCE,
      partialRipQualityMaxDistance:
        this.PARTIAL_RIP_QUALITY_MAX_DISTANCE ??
        this.PARTIAL_RIP_MAX_DISTANCE * 2,
      partialRipMaxAttempts: this.PARTIAL_RIP_MAX_ATTEMPTS,
    }
  }

  private publishOutsideInStats(): void {
    this.stats = {
      ...this.stats,
      outsideInRouteCount: this.outsideInRouteCount,
      outsideInCompletedRouteCount: this.outsideInCompletedRouteCount,
      outsideInFallbackRouteCount: this.outsideInFallbackRouteCount,
      outsideInForwardExpansionCount: this.outsideInForwardExpansionCount,
      outsideInReverseExpansionCount: this.outsideInReverseExpansionCount,
      outsideInDistancePruneCount: this.outsideInDistancePruneCount,
      outsideInMaxDistance: this.OUTSIDE_IN_MAX_DISTANCE,
    }
  }

  private createOutsideInFrontier(
    startPortId: PortId,
    startRegionId: RegionId,
    targetPortId: PortId,
  ): OutsideInFrontier {
    const queue = new MinHeap<OutsideInCandidate>([], (left, right) =>
      left.f === right.f ? left.g - right.g : left.f - right.f,
    )
    const h =
      Math.hypot(
        this.topology.portX[startPortId]! - this.topology.portX[targetPortId]!,
        this.topology.portY[startPortId]! - this.topology.portY[targetPortId]!,
      ) * this.DISTANCE_TO_COST
    const root: OutsideInCandidate = {
      portId: startPortId,
      nextRegionId: startRegionId,
      f: h,
      g: 0,
      h,
      travelDistance: 0,
    }
    queue.queue(root)
    return {
      queue,
      bestCostByHopId: new Map([
        [this.getHopId(startPortId, startRegionId), 0],
      ]),
      settledByPortId: new Map(),
      settledByRegionId: new Map(),
      targetPortId,
    }
  }

  private startOutsideInRouteSearch(routeId: RouteId): boolean {
    const startPortId = this.getRouteStartPortId(routeId)
    const endPortId = this.getRouteEndPortId(routeId)
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    const endRegionId = this.getEndingNextRegionId(routeId, endPortId)
    if (startRegionId === undefined || endRegionId === undefined) return false

    this.state.goalPortId = endPortId
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.outsideInRouteSearch = {
      routeId,
      forward: this.createOutsideInFrontier(
        startPortId,
        startRegionId,
        endPortId,
      ),
      reverse: this.createOutsideInFrontier(
        endPortId,
        endRegionId,
        startPortId,
      ),
      expandForwardNext: true,
      distanceLimitHit: false,
      bestJoinedCost: Number.POSITIVE_INFINITY,
    }
    this.outsideInRouteCount += 1
    this.publishOutsideInStats()
    return true
  }

  private dequeueFreshCandidate(
    frontier: OutsideInFrontier,
  ): OutsideInCandidate | undefined {
    while (frontier.queue.length > 0) {
      const candidate = frontier.queue.dequeue()!
      const hopId = this.getHopId(candidate.portId, candidate.nextRegionId)
      if (candidate.g <= (frontier.bestCostByHopId.get(hopId) ?? Infinity)) {
        return candidate
      }
    }
    return undefined
  }

  private recordSettledCandidate(
    frontier: OutsideInFrontier,
    candidate: OutsideInCandidate,
  ): void {
    const settledAtPort = frontier.settledByPortId.get(candidate.portId)
    if (!settledAtPort || candidate.g < settledAtPort.g) {
      frontier.settledByPortId.set(candidate.portId, candidate)
    }

    const settledInRegion =
      frontier.settledByRegionId.get(candidate.nextRegionId) ?? []
    settledInRegion.push(candidate)
    settledInRegion.sort((left, right) => left.g - right.g)
    if (settledInRegion.length > 16) settledInRegion.length = 16
    frontier.settledByRegionId.set(candidate.nextRegionId, settledInRegion)
  }

  private getCandidatePath(
    candidate: OutsideInCandidate,
  ): OutsideInCandidate[] {
    const path: OutsideInCandidate[] = []
    let cursor: Candidate | undefined = candidate
    while (cursor) {
      path.push(cursor as OutsideInCandidate)
      cursor = cursor.prevCandidate
    }
    path.reverse()
    return path
  }

  private buildJoinedCandidate(
    forwardCandidate: OutsideInCandidate,
    reverseCandidate: OutsideInCandidate,
  ): JoinedOutsideInCandidate | undefined {
    const forwardPath = this.getCandidatePath(forwardCandidate)
    const reversePath = this.getCandidatePath(reverseCandidate)
    const portIds = forwardPath.map(({ portId }) => portId)
    const regionIds = forwardPath
      .slice(0, -1)
      .map(({ nextRegionId }) => nextRegionId)

    if (forwardCandidate.portId !== reverseCandidate.portId) {
      if (forwardCandidate.nextRegionId !== reverseCandidate.nextRegionId) {
        return undefined
      }
      const connectorDistance = Math.hypot(
        this.topology.portX[forwardCandidate.portId]! -
          this.topology.portX[reverseCandidate.portId]!,
        this.topology.portY[forwardCandidate.portId]! -
          this.topology.portY[reverseCandidate.portId]!,
      )
      if (
        forwardCandidate.travelDistance +
          reverseCandidate.travelDistance +
          connectorDistance >
        this.OUTSIDE_IN_MAX_DISTANCE * 2
      ) {
        return undefined
      }
      const connectorG = this.computeG(
        forwardCandidate,
        reverseCandidate.portId,
      )
      if (!Number.isFinite(connectorG)) return undefined
      regionIds.push(forwardCandidate.nextRegionId)
      portIds.push(reverseCandidate.portId)
    }

    for (
      let reverseIndex = reversePath.length - 2;
      reverseIndex >= 0;
      reverseIndex--
    ) {
      const nextTowardGoal = reversePath[reverseIndex]!
      regionIds.push(nextTowardGoal.nextRegionId)
      portIds.push(nextTowardGoal.portId)
    }

    if (
      new Set(portIds).size !== portIds.length ||
      regionIds.length + 1 !== portIds.length
    ) {
      return undefined
    }

    let joinedCandidate: Candidate = {
      portId: portIds[0]!,
      nextRegionId: regionIds[0]!,
      f: 0,
      g: 0,
      h: 0,
    }
    for (let portIndex = 1; portIndex < portIds.length; portIndex++) {
      joinedCandidate = {
        portId: portIds[portIndex]!,
        prevRegionId: regionIds[portIndex - 1]!,
        nextRegionId: regionIds[portIndex] ?? regionIds[portIndex - 1]!,
        prevCandidate: joinedCandidate,
        f: 0,
        g: 0,
        h: 0,
      }
    }

    const connectorCost =
      forwardCandidate.portId === reverseCandidate.portId
        ? 0
        : this.computeG(forwardCandidate, reverseCandidate.portId) -
          forwardCandidate.g

    return {
      candidate: joinedCandidate,
      cost: forwardCandidate.g + reverseCandidate.g + connectorCost,
    }
  }

  private considerOutsideInJoins(
    candidate: OutsideInCandidate,
    expandingForward: boolean,
  ): void {
    const search = this.outsideInRouteSearch!
    const oppositeFrontier = expandingForward ? search.reverse : search.forward
    const considerJoinedCandidate = (
      joinedCandidate: JoinedOutsideInCandidate | undefined,
    ) => {
      if (!joinedCandidate || joinedCandidate.cost >= search.bestJoinedCost) {
        return
      }
      search.bestJoinedCandidate = joinedCandidate.candidate
      search.bestJoinedCost = joinedCandidate.cost
      search.remainingPostMeetingExpansions = 24
    }

    const samePortCandidate = oppositeFrontier.settledByPortId.get(
      candidate.portId,
    )
    if (samePortCandidate) {
      considerJoinedCandidate(
        expandingForward
          ? this.buildJoinedCandidate(candidate, samePortCandidate)
          : this.buildJoinedCandidate(samePortCandidate, candidate),
      )
    }

    for (const oppositeCandidate of oppositeFrontier.settledByRegionId.get(
      candidate.nextRegionId,
    ) ?? []) {
      considerJoinedCandidate(
        expandingForward
          ? this.buildJoinedCandidate(candidate, oppositeCandidate)
          : this.buildJoinedCandidate(oppositeCandidate, candidate),
      )
    }
  }

  private commitBestOutsideInJoin(): boolean {
    const joinedCandidate = this.outsideInRouteSearch?.bestJoinedCandidate
    if (!joinedCandidate) return false
    this.onPathFound(joinedCandidate)
    return true
  }

  private expandOutsideInFrontier(expandingForward: boolean): boolean {
    const search = this.outsideInRouteSearch!
    const frontier = expandingForward ? search.forward : search.reverse
    const candidate = this.dequeueFreshCandidate(frontier)
    if (!candidate) return false

    if (expandingForward) this.outsideInForwardExpansionCount += 1
    else this.outsideInReverseExpansionCount += 1

    if (this.isRegionReservedForDifferentNet(candidate.nextRegionId)) {
      return true
    }

    this.recordSettledCandidate(frontier, candidate)
    this.considerOutsideInJoins(candidate, expandingForward)

    for (const neighborPortId of this.topology.regionIncidentPorts[
      candidate.nextRegionId
    ] ?? []) {
      if (neighborPortId === candidate.portId) continue
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      const assignedNetId = this.state.portAssignment[neighborPortId]!
      if (
        assignedNetId !== -1 &&
        assignedNetId !== this.state.currentRouteNetId
      ) {
        continue
      }
      if (
        neighborPortId !== frontier.targetPortId &&
        this.problem.portSectionMask[neighborPortId] === 0
      ) {
        continue
      }

      const segmentDistance = Math.hypot(
        this.topology.portX[candidate.portId]! -
          this.topology.portX[neighborPortId]!,
        this.topology.portY[candidate.portId]! -
          this.topology.portY[neighborPortId]!,
      )
      const travelDistance = candidate.travelDistance + segmentDistance
      if (travelDistance > this.OUTSIDE_IN_MAX_DISTANCE) {
        search.distanceLimitHit = true
        this.outsideInDistancePruneCount += 1
        continue
      }

      const g = this.computeG(candidate, neighborPortId)
      if (!Number.isFinite(g)) continue
      const nextRegionId =
        this.topology.incidentPortRegion[neighborPortId]?.[0] ===
        candidate.nextRegionId
          ? this.topology.incidentPortRegion[neighborPortId]?.[1]
          : this.topology.incidentPortRegion[neighborPortId]?.[0]
      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNet(nextRegionId)
      ) {
        continue
      }

      const hopId = this.getHopId(neighborPortId, nextRegionId)
      if (g >= (frontier.bestCostByHopId.get(hopId) ?? Infinity)) continue
      frontier.bestCostByHopId.set(hopId, g)
      const h =
        Math.hypot(
          this.topology.portX[neighborPortId]! -
            this.topology.portX[frontier.targetPortId]!,
          this.topology.portY[neighborPortId]! -
            this.topology.portY[frontier.targetPortId]!,
        ) * this.DISTANCE_TO_COST
      frontier.queue.queue({
        portId: neighborPortId,
        prevRegionId: candidate.nextRegionId,
        nextRegionId,
        prevCandidate: candidate,
        f: g + h,
        g,
        h,
        travelDistance,
      })
    }

    return true
  }

  private fallBackToOneSidedRouteSearch(): void {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) return
    this.outsideInRouteSearch = undefined
    this.outsideInFallbackRouteCount += 1
    this.oneSidedFallbackRouteId = routeId
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.goalPortId = -1
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.unroutedRoutes.unshift(routeId)
    this.publishOutsideInStats()
  }

  override _step(): void {
    if (!this.OUTSIDE_IN_ROUTING) {
      super._step()
      return
    }

    const routeIdToAdvance =
      this.state.currentRouteId ?? this.state.unroutedRoutes[0]
    if (
      routeIdToAdvance !== undefined &&
      !this.partialRipRoutePlans.has(routeIdToAdvance)
    ) {
      super._step()
      return
    }

    if (this.oneSidedFallbackRouteId !== undefined) {
      super._step()
      return
    }

    if (this.state.currentRouteId === undefined) {
      if (this.state.unroutedRoutes.length === 0) {
        this.onAllRoutesRouted()
        return
      }

      const routeId = this.state.unroutedRoutes.shift()!
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = this.problem.routeNet[routeId]!
      this.routeAttemptCountByRouteId[routeId] += 1
      if (!this.startOutsideInRouteSearch(routeId)) {
        this.failed = true
        this.error = `Route ${routeId} has an endpoint without an incident region`
        return
      }
    }

    const search = this.outsideInRouteSearch
    if (!search) return

    let expanded = this.expandOutsideInFrontier(search.expandForwardNext)
    if (this.state.currentRouteId === undefined) return
    if (!expanded) {
      expanded = this.expandOutsideInFrontier(!search.expandForwardNext)
      if (this.state.currentRouteId === undefined) return
    }
    search.expandForwardNext = !search.expandForwardNext

    if (search.bestJoinedCandidate) {
      search.remainingPostMeetingExpansions =
        (search.remainingPostMeetingExpansions ?? 1) - 1
      if ((search.remainingPostMeetingExpansions ?? 0) <= 0) {
        this.commitBestOutsideInJoin()
        return
      }
    }

    if (
      !expanded &&
      search.forward.queue.length === 0 &&
      search.reverse.queue.length === 0
    ) {
      if (this.commitBestOutsideInJoin()) return
      this.outsideInRouteSearch = undefined
      if (search.distanceLimitHit) {
        this.fallBackToOneSidedRouteSearch()
      } else {
        this.onOutOfCandidates()
      }
    }

    this.publishOutsideInStats()
  }

  /**
   * Serialization replays segments route-by-route. Keep the live cost cache in
   * that same deterministic order before deciding whether a partial result is
   * better. This also avoids the boundary-angle counter's legacy shared-port
   * tie behavior producing a different score after round-tripping the output.
   */
  private rebuildIntersectionCachesInCanonicalRouteOrder(): void {
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )

    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      const segments = this.state.regionSegments[regionId]!
      segments.sort((left, right) => left[0] - right[0])
      for (const [routeId, fromPortId, toPortId] of segments) {
        this.state.currentRouteNetId = this.problem.routeNet[routeId]!
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  override onAllRoutesRouted(): void {
    const { state, topology } = this
    const maxRipAttempts = Math.min(
      this.RIP_THRESHOLD_RAMP_ATTEMPTS,
      this.PARTIAL_RIP_MAX_ATTEMPTS,
    )
    this.rebuildIntersectionCachesInCanonicalRouteOrder()
    const ripThresholdProgress =
      maxRipAttempts <= 0 ? 1 : Math.min(1, state.ripCount / maxRipAttempts)
    const currentRipThreshold =
      this.RIP_THRESHOLD_START +
      (this.RIP_THRESHOLD_END - this.RIP_THRESHOLD_START) * ripThresholdProgress
    const regionCosts = new Float64Array(topology.regionCount)
    const hotRegionIds: RegionId[] = []
    let maxRegionCost = 0
    let totalRegionCost = 0

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const regionCost =
        state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      regionCosts[regionId] = regionCost
      maxRegionCost = Math.max(maxRegionCost, regionCost)
      totalRegionCost += regionCost
      if (regionCost > currentRipThreshold) hotRegionIds.push(regionId)
    }

    const summary: RegionCostSummary = { maxRegionCost, totalRegionCost }
    this.captureBestSolvedState(summary)
    this.stats = {
      ...this.stats,
      currentRipThreshold,
      hotRegionCount: hotRegionIds.length,
      maxRegionCost,
      totalRegionCost,
      bestMaxRegionCost: this.bestSolvedStateSummary?.maxRegionCost,
      bestTotalRegionCost: this.bestSolvedStateSummary?.totalRegionCost,
      ripCount: state.ripCount,
    }
    this.publishPartialRipStats()

    if (hotRegionIds.length === 0 || state.ripCount >= maxRipAttempts) {
      this.restoreBestSolvedState()
      this.solved = true
      return
    }

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      state.regionCongestionCost[regionId] +=
        regionCosts[regionId]! * this.RIP_CONGESTION_REGION_COST_FACTOR
    }

    state.ripCount += 1
    const usedPartialRip = this.preparePartialRip(hotRegionIds, regionCosts)
    if (!usedPartialRip) {
      this.resetRoutingStateForRerip()
    }
    this.stats = {
      ...this.stats,
      ripCount: state.ripCount,
      maxRegionCostBeforeRip: maxRegionCost,
      reripRegionCount: hotRegionIds.length,
      reripMode: usedPartialRip ? "partial" : "full",
    }
    this.logRipEvent("hot_regions", maxRegionCost, {
      hotRegionCount: hotRegionIds.length,
      currentRipThreshold,
      reripMode: usedPartialRip ? "partial" : "full",
      partialRouteCount: usedPartialRip ? this.partialRipRoutePlans.size : 0,
    })
  }
}
