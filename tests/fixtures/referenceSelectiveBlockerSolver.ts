import { SelectiveReripTinyHyperGraphSolver, type SelectiveReripBlockerResource } from "../../lib/selective-rerip-tiny-hyper-graph-solver"
import { findDistinctOwnerBlockerPath, type DistinctOwnerBlockerSearchResult } from "./referenceDistinctOwnerBlockerPath"
type PortId = number
type RouteId = number
type RegionId = number
type RelaxedSearchState = { portId: number; nextRegionId: number }
type RelaxedSearchHopData = { resources: SelectiveReripBlockerResource[] }
type PortBlockerResource = Extract<SelectiveReripBlockerResource, {kind: "port"}>
type RelaxedSearchHop = { state: RelaxedSearchState; distance: number; owners: number[]; data: RelaxedSearchHopData }
type ReferenceHelpers = {
  getPortOwners(): Map<number, Set<number>>
  getRelaxedSearchHops(params: {
    state: RelaxedSearchState; goalPortId: number; routeNetId: number
    portOwners: ReadonlyMap<number, ReadonlySet<number>>
    portResources: Map<number, PortBlockerResource>
    hopTemplatesByRegion: Map<number, RelaxedSearchHop[]>
    forbiddenOwnerRouteIds: ReadonlySet<number>
  }): RelaxedSearchHop[]
}
/** Frozen consumer search: the production helpers retain live geometry/ownership validation. */
export class ReferenceSelectiveBlockerSolver extends SelectiveReripTinyHyperGraphSolver {
  public override findRelaxedBlockerPath(
    forbiddenOwnerRouteIds: ReadonlySet<RouteId> = new Set<RouteId>(),
  ): DistinctOwnerBlockerSearchResult<
    RelaxedSearchState,
    RouteId,
    RelaxedSearchHopData
  > {
    const helpers = this as unknown as ReferenceHelpers
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

    const portOwners = helpers.getPortOwners()
    const portResources = new Map<PortId, PortBlockerResource>()
    const hopTemplatesByRegion = new Map<RegionId, RelaxedSearchHop[]>()
    // Occupancy stays fixed during this synchronous search. Distinct owner
    // labels revisit the same hop, but their outgoing resources are identical.
    const hopsByState = new Map<number, RelaxedSearchHop[]>()
    return findDistinctOwnerBlockerPath({
      start: { portId: startPortId, nextRegionId: startRegionId },
      getStateKey: ({ portId, nextRegionId }): number =>
        this.getHopId(portId, nextRegionId),
      isGoal: ({ portId }): boolean => portId === goalPortId,
      getHops: (state): RelaxedSearchHop[] => {
        const key = this.getHopId(state.portId, state.nextRegionId)
        const cached = hopsByState.get(key)
        if (cached) return cached
        const hops = helpers.getRelaxedSearchHops({
          state,
          goalPortId,
          routeNetId,
          portOwners,
          portResources,
          hopTemplatesByRegion,
          forbiddenOwnerRouteIds,
        })
        hopsByState.set(key, hops)
        return hops
      },
      maxExpandedLabels: this.getRelaxedSearchExpansionLimit(),
      checkReachability: true,
    })
  }

}
