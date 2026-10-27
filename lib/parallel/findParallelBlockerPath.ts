import type {
  SelectiveReripTinyHyperGraphSolver,
  RelaxedBlockerSearchContext,
} from "../selective-rerip-tiny-hyper-graph-solver"
import type {
  RelaxedSearchState,
  RelaxedSearchHopData,
} from "../selective-rerip/relaxedBlockerSearchTypes"
import type { RouteId } from "../types"
import type { DistinctOwnerBlockerSearchResult } from "../find-distinct-owner-blocker-path"
import type { CompiledOwnerSearchOptions } from "./findDisconnectedOwnerGraph"
import { findOwnerPathInWasm, type OwnerGeometry } from "./findOwnerPathInWasm"

type OwnerSearchOptions = CompiledOwnerSearchOptions<
  RelaxedSearchState,
  number,
  RouteId,
  RelaxedSearchHopData
>
type ParallelOwnerSearch = (
  options: OwnerSearchOptions,
  geometry: OwnerGeometry<RelaxedSearchState, RouteId, RelaxedSearchHopData>,
  forbidden: ReadonlySet<RouteId>,
) => DistinctOwnerBlockerSearchResult<
  RelaxedSearchState,
  RouteId,
  RelaxedSearchHopData
>

/** Compile an owner search without introducing a WASM dependency into the serial solver. */
export function findParallelBlockerPath(
  solver: SelectiveReripTinyHyperGraphSolver,
  context: RelaxedBlockerSearchContext,
  search: ParallelOwnerSearch = findOwnerPathInWasm,
): DistinctOwnerBlockerSearchResult<
  RelaxedSearchState,
  RouteId,
  RelaxedSearchHopData
> {
  const { goalPortId, routeNetId, portOwners, forbiddenOwnerRouteIds } = context
  const searchOptions: OwnerSearchOptions = { ...context.searchOptions }
  searchOptions.checkReachability = true
  const firstReachabilityPort = new Int32Array(
    solver.topology.regionCount,
  ).fill(-1)
  searchOptions.getReachabilityStateKey = (state): number => {
    if (solver.isKnownSingleLayerRegion(state.nextRegionId))
      return solver.getHopId(state.portId, state.nextRegionId) * 2 + 1
    const first = firstReachabilityPort[state.nextRegionId]
    if (first === -1) firstReachabilityPort[state.nextRegionId] = state.portId
    return (
      state.nextRegionId * 4 + (first === -1 || first === state.portId ? 0 : 2)
    )
  }
  const stride = Math.max(
    1,
    ...solver.topology.incidentPortRegion.map((regions) => regions.length),
  )
  const geometry: OwnerGeometry<
    RelaxedSearchState,
    RouteId,
    RelaxedSearchHopData
  > = {
    stride,
    goal: goalPortId,
    nativeGraph: {
      cacheToken: context.cacheToken,
      assignment: solver.state.portAssignment,
      portOwners,
      segments: solver.state.regionSegments,
      net: routeNetId,
      forbidden: forbiddenOwnerRouteIds,
    },
    stateId: (state) => solver.getHopId(state.portId, state.nextRegionId),
    state: (id) => {
      const portId = Math.floor(id / stride),
        nextRegionId = solver.topology.incidentPortRegion[portId]![id % stride]!
      return { portId, nextRegionId }
    },
    templateKey: (state) => state.nextRegionId,
    templates: (state) => {
      if (solver.isKnownSingleLayerRegion(state.nextRegionId)) return undefined
      return context.getHopTemplates(state)
    },
    distance: (a, b) =>
      Math.hypot(
        solver.topology.portX[a]! - solver.topology.portX[b]!,
        solver.topology.portY[a]! - solver.topology.portY[b]!,
      ),
  }
  return search(searchOptions, geometry, forbiddenOwnerRouteIds)
}
