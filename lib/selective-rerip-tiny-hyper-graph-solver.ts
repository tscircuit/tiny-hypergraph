import {
  createEmptyRegionIntersectionCache,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "./outside-in-partial-rip-tiny-hypergraph-solver"
import type { DistinctOwnerBlockerSearchResult } from "./find-distinct-owner-blocker-path"
import { findResourceBlockerPath } from "./findResourceBlockerPath"
import type { NetId, PortId, RegionId, RouteId } from "./types"
import { PortDistanceQueue } from "./PortDistanceQueue"

type RelaxedSearchState = {
  portId: PortId
  nextRegionId: RegionId
}

type PortDistanceSearch = {
  costs: Float64Array
  settled: Uint8Array
  blockedPorts: Uint8Array
  queue: PortDistanceQueue
}

type PortBlockerResource = {
  kind: "port"
  portId: PortId
  owners: RouteId[]
}

type SameLayerIntersectionBlockerResource = {
  kind: "same_layer_intersection"
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
  owners: RouteId[]
}

export type SelectiveReripBlockerResource =
  | PortBlockerResource
  | SameLayerIntersectionBlockerResource

type RelaxedSearchHopData = {
  resources: SelectiveReripBlockerResource[]
}

export type FailedOwnerPairCount = {
  failedRouteId: RouteId
  ownerRouteId: RouteId
  count: number
}

export type SelectiveReripTinyHyperGraphStats = {
  selectiveRipCount: number
  selectivelyRippedRouteCount: number
  globalReripCount: number
  globalReripReason?:
    | "no_path"
    | "expansion_limit"
    | "no_blocker_path"
    | "failed_owner_cycle"
  alternateBlockerSearchCount: number
  alternateOwnerCount: number
  failedOwnerPairCount: number
  maxFailedOwnerPairCount: number
  failedOwnerPairs: FailedOwnerPairCount[]
  lastFailedRouteId?: RouteId
  lastDirectOwnerRouteIds: RouteId[]
  lastRepeatedOwnerRouteIds: RouteId[]
  lastAlternateOwnerRouteIds: RouteId[]
  lastRippedRouteIds: RouteId[]
  lastRelaxedSearchExpandedLabelCount: number
  lastAlternateSearchExpandedLabelCount: number
}

const createInitialSelectiveReripStats =
  (): SelectiveReripTinyHyperGraphStats => ({
    selectiveRipCount: 0,
    selectivelyRippedRouteCount: 0,
    globalReripCount: 0,
    alternateBlockerSearchCount: 0,
    alternateOwnerCount: 0,
    failedOwnerPairCount: 0,
    maxFailedOwnerPairCount: 0,
    failedOwnerPairs: [],
    lastDirectOwnerRouteIds: [],
    lastRepeatedOwnerRouteIds: [],
    lastAlternateOwnerRouteIds: [],
    lastRippedRouteIds: [],
    lastRelaxedSearchExpandedLabelCount: 0,
    lastAlternateSearchExpandedLabelCount: 0,
  })

export function orderConnectionsByNetCardinality<TConnection>(
  connections: readonly TConnection[],
  getNetId: (connection: TConnection) => string | number,
): TConnection[] {
  const connectionCountByNetId = new Map<string | number, number>()
  for (const connection of connections) {
    const netId = getNetId(connection)
    connectionCountByNetId.set(
      netId,
      (connectionCountByNetId.get(netId) ?? 0) + 1,
    )
  }

  return connections
    .map((connection, index) => ({ connection, index }))
    .sort(
      (left, right) =>
        (connectionCountByNetId.get(getNetId(right.connection)) ?? 0) -
          (connectionCountByNetId.get(getNetId(left.connection)) ?? 0) ||
        left.index - right.index,
    )
    .map(({ connection }) => connection)
}

export function selectOwnerRouteIdsToRip(params: {
  failedRouteId: RouteId
  directOwnerRouteIds: readonly RouteId[]
  alternateOwnerRouteIds?: readonly RouteId[]
}): Set<RouteId> {
  const rippedRouteIds = new Set<RouteId>(
    params.alternateOwnerRouteIds ?? params.directOwnerRouteIds,
  )
  rippedRouteIds.delete(params.failedRouteId)
  if (rippedRouteIds.size === 0) {
    throw new Error(
      `SelectiveReripTinyHyperGraphSolver: route ${params.failedRouteId} has blocker resources but no distinct committed owner can be reripped`,
    )
  }

  return rippedRouteIds
}

export function orderRoutesAfterSelectiveRerip(params: {
  failedRouteId: RouteId
  pendingRouteIds: readonly RouteId[]
  rippedRouteIds: ReadonlySet<RouteId>
}): RouteId[] {
  const pendingRouteIds = params.pendingRouteIds.filter(
    (routeId) =>
      routeId !== params.failedRouteId && !params.rippedRouteIds.has(routeId),
  )
  const rippedRouteIds = [...params.rippedRouteIds].filter(
    (routeId) => routeId !== params.failedRouteId,
  )

  return [params.failedRouteId, ...pendingRouteIds, ...rippedRouteIds]
}

/**
 * Keeps the normal tiny-hypergraph route acceptance policy while replacing a
 * full rerip with a local repair of the occupied resources blocking a route.
 * Committing the cleared witness preserves progress while congestion history
 * encourages later repairs to use different local resources.
 */
export class SelectiveReripTinyHyperGraphSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  private readonly blockerResourceHistory = new Map<string, number>()
  private readonly staticPortCostsByNetAndGoal = new Map<
    NetId,
    Map<PortId, PortDistanceSearch>
  >()

  private readonly failedOwnerPairCounts = new Map<
    RouteId,
    Map<RouteId, number>
  >()

  private readonly selectiveReripStats = createInitialSelectiveReripStats()

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.USE_LAZY_ROUTE_HEURISTIC = true
  }

  override resetRoutingStateForRerip(): void {
    this.staticPortCostsByNetAndGoal.clear()
    super.resetRoutingStateForRerip()
  }

  override onAllRoutesRouted(): void {
    this.staticPortCostsByNetAndGoal.clear()
    super.onAllRoutesRouted()
  }

  /**
   * Reverse shortest-path costs avoid occupied ports and account for cramped
   * port penalties. Adding routes only removes available edges, so cached
   * lower bounds remain valid until a rip releases occupied ports.
   * Ignoring entry direction and region crossings keeps the search relaxed.
   * Resume each reverse search only until the requested port is settled.
   */
  override computeH(portId: PortId): number {
    const routeId = this.state.currentRouteId!
    const routeNetId = this.problem.routeNet[routeId]!
    const goalPortId = this.getRouteEndPortId(routeId)
    let costsByGoal = this.staticPortCostsByNetAndGoal.get(routeNetId)
    if (!costsByGoal) {
      costsByGoal = new Map<PortId, PortDistanceSearch>()
      this.staticPortCostsByNetAndGoal.set(routeNetId, costsByGoal)
    }
    let search = costsByGoal.get(goalPortId)
    if (!search) {
      const costs = new Float64Array(this.topology.portCount).fill(
        Number.POSITIVE_INFINITY,
      )
      costs[goalPortId] = 0
      const queue = new PortDistanceQueue(this.topology.portCount)
      queue.queue(goalPortId, 0)
      // Snapshot occupancy so resumed searches use the same relaxed graph
      // even after another route commits between queries for this net.
      const blockedPorts = new Uint8Array(this.topology.portCount)
      for (
        let candidatePortId = 0;
        candidatePortId < blockedPorts.length;
        candidatePortId++
      ) {
        const assignedNetId = this.state.portAssignment[candidatePortId]!
        if (
          this.isPortReservedForDifferentNet(candidatePortId) ||
          (assignedNetId !== -1 && assignedNetId !== routeNetId)
        ) {
          blockedPorts[candidatePortId] = 1
        }
      }
      search = {
        costs,
        settled: new Uint8Array(this.topology.portCount),
        blockedPorts,
        queue,
      }
      costsByGoal.set(goalPortId, search)
    }
    const { costs, settled, blockedPorts, queue } = search
    if (blockedPorts[portId] && portId !== goalPortId) {
      return Number.POSITIVE_INFINITY
    }
    while (!settled[portId] && queue.length > 0) {
      const currentPortId = queue.dequeue()!
      const currentCost = costs[currentPortId]!
      const currentX = this.topology.portX[currentPortId]!
      const currentY = this.topology.portY[currentPortId]!
      const currentPortPenalty = this.problem.portPenalty?.[currentPortId] ?? 0
      for (const regionId of this.topology.incidentPortRegion[
        currentPortId
      ]!) {
        if (this.isRegionReservedForDifferentNet(regionId)) continue
        for (const previousPortId of this.topology.regionIncidentPorts[
          regionId
        ]!) {
          if (settled[previousPortId] || blockedPorts[previousPortId]) continue
          const dx =
            this.topology.portX[previousPortId]! -
            currentX
          const dy =
            this.topology.portY[previousPortId]! -
            currentY
          const cost =
            currentCost +
            Math.sqrt(dx * dx + dy * dy) * this.DISTANCE_TO_COST +
            currentPortPenalty
          if (cost >= costs[previousPortId]!) continue
          costs[previousPortId] = cost
          queue.queue(previousPortId, cost)
        }
      }
      settled[currentPortId] = 1
    }
    return costs[portId]!
  }

  getSelectiveReripStats(): SelectiveReripTinyHyperGraphStats {
    return {
      ...this.selectiveReripStats,
      failedOwnerPairs: this.selectiveReripStats.failedOwnerPairs.map(
        (pair) => ({
          ...pair,
        }),
      ),
      lastDirectOwnerRouteIds: [
        ...this.selectiveReripStats.lastDirectOwnerRouteIds,
      ],
      lastRepeatedOwnerRouteIds: [
        ...this.selectiveReripStats.lastRepeatedOwnerRouteIds,
      ],
      lastAlternateOwnerRouteIds: [
        ...this.selectiveReripStats.lastAlternateOwnerRouteIds,
      ],
      lastRippedRouteIds: [...this.selectiveReripStats.lastRippedRouteIds],
    }
  }

  override onOutOfCandidates(): void {
    const failedRouteId = this.state.currentRouteId
    if (failedRouteId === undefined) {
      throw new Error(
        "SelectiveReripTinyHyperGraphSolver: candidate search exhausted without a current route",
      )
    }

    this.staticPortCostsByNetAndGoal.clear()
    const directPath = this.findRelaxedBlockerPathPreferringPreservedRoutes()
    if (!directPath.found || directPath.owners.size === 0) {
      this.selectiveReripStats.globalReripCount += 1
      this.selectiveReripStats.globalReripReason = !directPath.found
        ? directPath.reason
        : "no_blocker_path"
      this.selectiveReripStats.lastFailedRouteId = failedRouteId
      this.selectiveReripStats.lastDirectOwnerRouteIds = []
      this.selectiveReripStats.lastRepeatedOwnerRouteIds = []
      this.selectiveReripStats.lastAlternateOwnerRouteIds = []
      this.selectiveReripStats.lastRippedRouteIds = []
      this.selectiveReripStats.lastRelaxedSearchExpandedLabelCount =
        directPath.expandedLabelCount
      this.selectiveReripStats.lastAlternateSearchExpandedLabelCount = 0
      super.onOutOfCandidates()
      this.publishSelectiveReripStats()
      return
    }

    const directOwnerRouteIds = [...directPath.owners]
    const repeatedOwnerRouteIds: RouteId[] = []
    for (const ownerRouteId of directOwnerRouteIds) {
      const count = this.incrementFailedOwnerPair(failedRouteId, ownerRouteId)
      if (count >= 2) repeatedOwnerRouteIds.push(ownerRouteId)
    }

    const rippedRouteIds = selectOwnerRouteIdsToRip({
      failedRouteId,
      directOwnerRouteIds,
    })
    this.clearPartialRipPlans(rippedRouteIds)
    for (const hop of directPath.hops) {
      for (const resource of hop.data?.resources ?? []) {
        const key = this.getBlockerResourceKey(resource)
        this.blockerResourceHistory.set(
          key,
          (this.blockerResourceHistory.get(key) ?? 0) + 1,
        )
        const regionIds =
          resource.kind === "port"
            ? this.topology.incidentPortRegion[resource.portId]!
            : [resource.regionId]
        for (const regionId of regionIds) {
          this.state.regionCongestionCost[regionId] +=
            resource.owners.length * this.RIP_CONGESTION_REGION_COST_FACTOR
        }
      }
    }

    this.rebuildCommittedState(rippedRouteIds)
    this.state.ripCount += 1
    this.state.currentRouteId = failedRouteId
    this.state.currentRouteNetId = this.problem.routeNet[failedRouteId]!
    this.state.unroutedRoutes = orderRoutesAfterSelectiveRerip({
      failedRouteId,
      pendingRouteIds: this.state.unroutedRoutes,
      rippedRouteIds,
    }).filter((routeId) => routeId !== failedRouteId)
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.state.goalPortId = this.getRouteEndPortId(failedRouteId)
    let candidate: Candidate | undefined
    for (const state of directPath.states) {
      const g = candidate ? this.computeG(candidate, state.portId) : 0
      if (!Number.isFinite(g)) {
        throw new Error(
          "Cleared blocker path still violates a hard routing constraint",
        )
      }
      candidate = { ...state, g, h: 0, f: g, prevCandidate: candidate }
    }
    if (!candidate || candidate.portId !== this.state.goalPortId) {
      throw new Error("Cleared blocker path does not reach the route goal")
    }
    this.onPathFound(candidate)

    this.selectiveReripStats.selectiveRipCount += 1
    this.selectiveReripStats.selectivelyRippedRouteCount += rippedRouteIds.size
    this.selectiveReripStats.lastFailedRouteId = failedRouteId
    this.selectiveReripStats.lastDirectOwnerRouteIds = directOwnerRouteIds
    this.selectiveReripStats.lastRepeatedOwnerRouteIds = repeatedOwnerRouteIds
    this.selectiveReripStats.lastAlternateOwnerRouteIds = []
    this.selectiveReripStats.lastRippedRouteIds = [...rippedRouteIds]
    this.selectiveReripStats.lastRelaxedSearchExpandedLabelCount =
      directPath.expandedLabelCount
    this.selectiveReripStats.lastAlternateSearchExpandedLabelCount = 0
    this.publishSelectiveReripStats()
  }

  private getBlockerResourceKey(
    resource: SelectiveReripBlockerResource,
  ): string {
    if (resource.kind === "port") return `port:${resource.portId}`
    const firstPortId = Math.min(resource.fromPortId, resource.toPortId)
    const secondPortId = Math.max(resource.fromPortId, resource.toPortId)
    return `crossing:${resource.regionId}:${firstPortId}:${secondPortId}`
  }

  protected findRelaxedBlockerPath(
    forbiddenOwnerRouteIds: ReadonlySet<RouteId> = new Set<RouteId>(),
  ): DistinctOwnerBlockerSearchResult<
    RelaxedSearchState,
    RouteId,
    RelaxedSearchHopData
  > {
    const routeId = this.state.currentRouteId
    const routeNetId = this.state.currentRouteNetId
    if (routeId === undefined || routeNetId === undefined) {
      throw new Error(
        "SelectiveReripTinyHyperGraphSolver: blocker search requires a current route and net",
      )
    }

    const startPortId = this.getRouteStartPortId(routeId)
    const goalPortId = this.getRouteEndPortId(routeId)
    const startRegionId = this.getStartingNextRegionId(routeId, startPortId)
    if (startRegionId === undefined) {
      throw new Error(
        `SelectiveReripTinyHyperGraphSolver: route ${this.describeRoute(routeId)} has no starting region for blocker search`,
      )
    }

    const portOwners = this.getPortOwners()
    return findResourceBlockerPath({
      start: { portId: startPortId, nextRegionId: startRegionId },
      getStateKey: ({ portId, nextRegionId }): number =>
        this.getHopId(portId, nextRegionId),
      isGoal: ({ portId }): boolean => portId === goalPortId,
      getHops: (state) =>
        this.getRelaxedSearchHops({
          state,
          goalPortId,
          routeNetId,
          portOwners,
          forbiddenOwnerRouteIds,
        }),
      getBlockerCost: (hop): number =>
        (hop.data?.resources ?? []).reduce((cost, resource) => {
          const previousConflicts =
            this.blockerResourceHistory.get(
              this.getBlockerResourceKey(resource),
            ) ?? 0
          return cost + resource.owners.length * (1 + previousConflicts)
        }, 0),
      maxExpandedLabels: this.getRelaxedSearchExpansionLimit(),
    })
  }

  protected findRelaxedBlockerPathPreferringPreservedRoutes(
    forbiddenOwnerRouteIds: ReadonlySet<RouteId> = new Set<RouteId>(),
  ): DistinctOwnerBlockerSearchResult<
    RelaxedSearchState,
    RouteId,
    RelaxedSearchHopData
  > {
    const preferredPreservedRouteIds =
      this.getRouteIdsPreferredForPreservation()
    if (preferredPreservedRouteIds.size === 0) {
      return this.findRelaxedBlockerPath(forbiddenOwnerRouteIds)
    }

    const preferredForbiddenOwnerRouteIds = new Set(forbiddenOwnerRouteIds)
    for (const routeId of preferredPreservedRouteIds) {
      preferredForbiddenOwnerRouteIds.add(routeId)
    }
    const preferredPath = this.findRelaxedBlockerPath(
      preferredForbiddenOwnerRouteIds,
    )
    if (preferredPath.found && preferredPath.owners.size > 0) {
      return preferredPath
    }

    return this.findRelaxedBlockerPath(forbiddenOwnerRouteIds)
  }

  protected getRelaxedSearchExpansionLimit(): number {
    let incidentHopCount = 0
    for (const incidentRegions of this.topology.incidentPortRegion) {
      incidentHopCount += incidentRegions.length
    }
    const ownerScale = Math.max(
      4,
      Math.ceil(Math.log2(this.problem.routeCount + 1)),
    )
    return Math.max(4096, incidentHopCount * ownerScale * 4)
  }

  private getRelaxedSearchHops(params: {
    state: RelaxedSearchState
    goalPortId: PortId
    routeNetId: number
    portOwners: ReadonlyMap<PortId, ReadonlySet<RouteId>>
    forbiddenOwnerRouteIds: ReadonlySet<RouteId>
  }): Array<{
    state: RelaxedSearchState
    distance: number
    owners: RouteId[]
    data: RelaxedSearchHopData
  }> {
    const { state, goalPortId, routeNetId } = params
    if (this.isRegionReservedForDifferentNet(state.nextRegionId)) return []

    const hops: Array<{
      state: RelaxedSearchState
      distance: number
      owners: RouteId[]
      data: RelaxedSearchHopData
    }> = []
    for (const neighborPortId of this.topology.regionIncidentPorts[
      state.nextRegionId
    ] ?? []) {
      if (neighborPortId === state.portId) continue
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (
        neighborPortId !== goalPortId &&
        this.problem.portSectionMask[neighborPortId] === 0
      ) {
        continue
      }

      const resources = this.getHopBlockerResources({
        regionId: state.nextRegionId,
        fromPortId: state.portId,
        toPortId: neighborPortId,
        routeNetId,
        portOwners: params.portOwners,
      })
      const owners = [
        ...new Set(resources.flatMap((resource) => resource.owners)),
      ]
      if (
        owners.some((ownerRouteId) =>
          params.forbiddenOwnerRouteIds.has(ownerRouteId),
        )
      ) {
        continue
      }

      let nextRegionId = state.nextRegionId
      if (neighborPortId !== goalPortId) {
        const [firstRegionId, secondRegionId] =
          this.topology.incidentPortRegion[neighborPortId] ?? []
        nextRegionId =
          firstRegionId === state.nextRegionId ? secondRegionId : firstRegionId
        if (
          nextRegionId === undefined ||
          this.isRegionReservedForDifferentNet(nextRegionId)
        ) {
          continue
        }
      }

      hops.push({
        state: { portId: neighborPortId, nextRegionId },
        distance:
          Math.hypot(
            this.topology.portX[state.portId]! -
              this.topology.portX[neighborPortId]!,
            this.topology.portY[state.portId]! -
              this.topology.portY[neighborPortId]!,
          ) * this.DISTANCE_TO_COST +
          (this.problem.portPenalty?.[neighborPortId] ?? 0) +
          this.state.regionCongestionCost[state.nextRegionId]! +
          this.computeRegionCostForRegion(
            state.nextRegionId,
            0,
            0,
            this.topology.portZ[state.portId] !==
              this.topology.portZ[neighborPortId]
              ? 1
              : 0,
            1,
          ),
        owners,
        data: { resources },
      })
    }

    return hops
  }

  private getHopBlockerResources(params: {
    regionId: RegionId
    fromPortId: PortId
    toPortId: PortId
    routeNetId: number
    portOwners: ReadonlyMap<PortId, ReadonlySet<RouteId>>
  }): SelectiveReripBlockerResource[] {
    const resources: SelectiveReripBlockerResource[] = []
    const assignedNetId = this.state.portAssignment[params.toPortId]!
    if (assignedNetId !== -1 && assignedNetId !== params.routeNetId) {
      const owners = [
        ...(params.portOwners.get(params.toPortId) ?? new Set<RouteId>()),
      ].filter(
        (routeId) => this.problem.routeNet[routeId] !== params.routeNetId,
      )
      if (owners.length === 0) {
        throw new Error(
          `SelectiveReripTinyHyperGraphSolver: port ${params.toPortId} is assigned to foreign net ${assignedNetId} without a committed route owner`,
        )
      }
      resources.push({ kind: "port", portId: params.toPortId, owners })
    }

    const sameLayerIntersectionOwners = this.getHardBlockedCrossingOwners(
      params.regionId,
      params.fromPortId,
      params.toPortId,
    )
    if (sameLayerIntersectionOwners.length > 0) {
      resources.push({
        kind: "same_layer_intersection",
        regionId: params.regionId,
        fromPortId: params.fromPortId,
        toPortId: params.toPortId,
        owners: sameLayerIntersectionOwners,
      })
    }

    return resources
  }

  private getPortOwners(): Map<PortId, Set<RouteId>> {
    const ownersByPort = new Map<PortId, Set<RouteId>>()
    for (const segments of this.state.regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments) {
        for (const portId of [fromPortId, toPortId]) {
          const owners = ownersByPort.get(portId) ?? new Set<RouteId>()
          owners.add(routeId)
          ownersByPort.set(portId, owners)
        }
      }
    }

    return ownersByPort
  }

  private getHardBlockedCrossingOwners(
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ): RouteId[] {
    if (!this.isKnownSingleLayerRegion(regionId)) return []

    const routeNetId = this.state.currentRouteNetId
    if (routeNetId === undefined) {
      throw new Error(
        "SelectiveReripTinyHyperGraphSolver: crossing ownership requires a current route net",
      )
    }
    const owners = new Set<RouteId>()
    for (const [ownerRouteId, ownerFromPortId, ownerToPortId] of this.state
      .regionSegments[regionId] ?? []) {
      if (this.problem.routeNet[ownerRouteId] === routeNetId) continue
      if (
        this.segmentsCrossOnSameLayer(
          regionId,
          fromPortId,
          toPortId,
          ownerFromPortId,
          ownerToPortId,
        )
      ) {
        owners.add(ownerRouteId)
      }
    }

    return [...owners]
  }

  private segmentsCrossOnSameLayer(
    regionId: RegionId,
    firstFromPortId: PortId,
    firstToPortId: PortId,
    secondFromPortId: PortId,
    secondToPortId: PortId,
  ): boolean {
    const first = {
      ...this.populateSegmentGeometryScratch(
        regionId,
        firstFromPortId,
        firstToPortId,
      ),
    }
    const second = {
      ...this.populateSegmentGeometryScratch(
        regionId,
        secondFromPortId,
        secondToPortId,
      ),
    }
    if ((first.layerMask & second.layerMask) === 0) return false
    if (
      first.lesserAngle === second.lesserAngle ||
      first.lesserAngle === second.greaterAngle ||
      first.greaterAngle === second.lesserAngle ||
      first.greaterAngle === second.greaterAngle
    ) {
      return false
    }

    const secondLesserInsideFirst =
      first.lesserAngle < second.lesserAngle &&
      second.lesserAngle < first.greaterAngle
    const secondGreaterInsideFirst =
      first.lesserAngle < second.greaterAngle &&
      second.greaterAngle < first.greaterAngle
    return secondLesserInsideFirst !== secondGreaterInsideFirst
  }

  private rebuildCommittedState(rippedRouteIds: ReadonlySet<RouteId>): void {
    this.state.regionSegments = this.state.regionSegments.map((segments) =>
      segments.filter(([routeId]) => !rippedRouteIds.has(routeId)),
    )
    this.state.portAssignment.fill(-1)
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )

    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        const routeNetId = this.problem.routeNet[routeId]!
        this.state.currentRouteNetId = routeNetId
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            throw new Error(
              `SelectiveReripTinyHyperGraphSolver: rebuilding committed routes found cross-net ownership at port ${portId} between net ${assignedNetId} and net ${routeNetId}`,
            )
          }
          this.state.portAssignment[portId] = routeNetId
        }
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  private incrementFailedOwnerPair(
    failedRouteId: RouteId,
    ownerRouteId: RouteId,
  ): number {
    const ownerCounts =
      this.failedOwnerPairCounts.get(failedRouteId) ??
      new Map<RouteId, number>()
    const count = (ownerCounts.get(ownerRouteId) ?? 0) + 1
    ownerCounts.set(ownerRouteId, count)
    this.failedOwnerPairCounts.set(failedRouteId, ownerCounts)
    return count
  }

  private publishSelectiveReripStats(): void {
    const failedOwnerPairs: FailedOwnerPairCount[] = []
    for (const [failedRouteId, ownerCounts] of this.failedOwnerPairCounts) {
      for (const [ownerRouteId, count] of ownerCounts) {
        failedOwnerPairs.push({ failedRouteId, ownerRouteId, count })
      }
    }
    failedOwnerPairs.sort(
      (left, right) =>
        left.failedRouteId - right.failedRouteId ||
        left.ownerRouteId - right.ownerRouteId,
    )
    this.selectiveReripStats.failedOwnerPairs = failedOwnerPairs
    this.selectiveReripStats.failedOwnerPairCount = failedOwnerPairs.length
    this.selectiveReripStats.maxFailedOwnerPairCount = Math.max(
      0,
      ...failedOwnerPairs.map(({ count }) => count),
    )
    this.stats = { ...this.stats, ...this.getSelectiveReripStats() }
  }

  private describeRoute(routeId: RouteId): string {
    const connectionId = this.problem.routeMetadata?.[routeId]?.connectionId
    return connectionId === undefined
      ? String(routeId)
      : `${routeId} (${String(connectionId)})`
  }
}
