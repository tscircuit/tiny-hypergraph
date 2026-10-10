import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchOptions,
} from "./find-distinct-owner-blocker-path"

export type OwnedRelaxedSearchState = {
  portId: number
  nextRegionId: number
}

/** Private adjacency plan for a stable, caller-owned synchronous search. */
export type OwnedRelaxedHyperedgeRow<TOwner, THopData = unknown> = {
  /**
   * Shared template identity; absent for ordinary single-layer rows. Shared
   * rows differ only in the representative source's excluded occurrences.
   */
  hyperedgeId?: object
  regionId: number
  /** The first cache representative, which may differ from a later caller. */
  sourcePortId: number
  templates: readonly DistinctOwnerBlockerHop<
    OwnedRelaxedSearchState,
    TOwner,
    THopData
  >[]
  /**
   * Sorted raw occurrences whose destination port equals sourcePortId.
   * These are exactly the representative source's excluded occurrences.
   */
  excludedTemplateIndices: readonly number[]
  /**
   * Private rows may provide scalar distances and materialize only accepted
   * hops. Ordinary rows retain their original hop references.
   */
  getHopDistance?: (templateIndex: number) => number
  getHop: (
    templateIndex: number,
    yieldedHopIndex: number,
    distance?: number,
  ) => DistinctOwnerBlockerHop<OwnedRelaxedSearchState, TOwner, THopData>
  /** Present only for the initial exact-row screening and generic fallback. */
  eagerHops?: readonly DistinctOwnerBlockerHop<
    OwnedRelaxedSearchState,
    TOwner,
    THopData
  >[]
  /** A proved finite, nonnegative upper bound for every included edge. */
  maxHopDistance?: number
}

export type OwnedRelaxedHyperedgeSearchOptions<
  TOwner,
  THopData = unknown,
> = Omit<
  DistinctOwnerBlockerSearchOptions<
    OwnedRelaxedSearchState,
    number,
    TOwner,
    THopData
  >,
  "getHops"
> & {
  getRow: (
    state: OwnedRelaxedSearchState,
  ) => OwnedRelaxedHyperedgeRow<TOwner, THopData>
  /** The caller has certified all cumulative native distances finite. */
  finiteCumulativeDistances: boolean
}
