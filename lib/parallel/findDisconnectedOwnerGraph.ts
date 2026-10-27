import type { DistinctOwnerBlockerSearchOptions as SearchOptions, DistinctOwnerBlockerSearchFailure } from "../find-distinct-owner-blocker-path"

export type CompiledOwnerSearchOptions<TState, TKey, TOwner, TData = unknown> = SearchOptions<TState, TKey, TOwner, TData> & {
  /** The caller proves these states equivalent for unweighted connectivity. */
  getReachabilityStateKey?: (state: TState) => unknown
}

export const findDisconnectedOwnerGraph = <TState, TStateKey, TOwner, THopData>(
  options: CompiledOwnerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >,
  maxExpandedStates: number,
): DistinctOwnerBlockerSearchFailure | undefined => {
  const queue = [options.start]
  const reachabilityKey = options.getReachabilityStateKey ?? options.getStateKey
  const seenStateKeys = new Set([reachabilityKey(options.start)])
  const originalStateKeys = options.getReachabilityStateKey ? new Set([options.getStateKey(options.start)]) : undefined
  let expandedStateCount = 0
  let totalHopDistance = 0

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const state = queue[queueIndex]!
    if (options.isGoal(state)) return undefined
    // An incomplete precheck cannot rule out a path. Keep the original search
    // and its label budget when this traversal reaches the same work limit.
    if (expandedStateCount >= maxExpandedStates) return undefined
    expandedStateCount++

    for (const hop of options.getHops(state)) {
      totalHopDistance += hop.distance
      // Preserve the weighted search's validation and overflow behavior.
      if (hop.distance < 0 || !Number.isFinite(totalHopDistance)) {
        return undefined
      }
      if (originalStateKeys) {
        originalStateKeys.add(options.getStateKey(hop.state))
        if (originalStateKeys.size > maxExpandedStates) return undefined
        if (options.isGoal(hop.state)) return undefined
      }
      const stateKey = reachabilityKey(hop.state)
      if (seenStateKeys.has(stateKey)) continue
      seenStateKeys.add(stateKey)
      queue.push(hop.state)
    }
  }

  return {
    found: false,
    reason: "no_path",
    expandedLabelCount: originalStateKeys?.size ?? expandedStateCount,
  }
}

