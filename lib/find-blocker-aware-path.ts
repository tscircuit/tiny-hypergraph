import { MinHeap } from "./MinHeap"
import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchOptions,
  DistinctOwnerBlockerSearchResult,
  DistinctOwnerBlockerSearchSuccess,
} from "./find-distinct-owner-blocker-path"

export type BlockerAwarePathSearchOptions<
  TState,
  TStateKey,
  TOwner,
  THopData = unknown,
> = Omit<
  DistinctOwnerBlockerSearchOptions<TState, TStateKey, TOwner, THopData>,
  "checkReachability"
> & {
  getDistanceHeuristic?: (state: TState) => number
  blockerCrossingPenalty: number
}

type BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData> = {
  state: TState
  stateKey: TStateKey
  cost: number
  distance: number
  estimatedCost: number
  parent: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData> | null
  incomingHop: DistinctOwnerBlockerHop<TState, TOwner, THopData> | null
  queueOrder: number
}

const compareBlockerAwarePathLabels = <TState, TStateKey, TOwner, THopData>(
  left: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData>,
  right: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData>,
): number =>
  left.estimatedCost - right.estimatedCost ||
  left.cost - right.cost ||
  left.queueOrder - right.queueOrder

const getDistanceHeuristic = <TState, TStateKey, TOwner, THopData>(
  state: TState,
  options: BlockerAwarePathSearchOptions<TState, TStateKey, TOwner, THopData>,
): number => {
  const heuristic = options.getDistanceHeuristic?.(state) ?? 0
  if (!Number.isFinite(heuristic) || heuristic < 0) {
    throw new Error(
      "Blocker-aware path distance heuristics must be finite and >= 0",
    )
  }
  return heuristic
}

const reconstructBlockerAwarePath = <TState, TStateKey, TOwner, THopData>(
  goal: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData>,
  expandedLabelCount: number,
): DistinctOwnerBlockerSearchSuccess<TState, TOwner, THopData> => {
  const states: TState[] = []
  const hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopData>> = []
  const owners = new Set<TOwner>()
  let label: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData> | null =
    goal
  while (label) {
    states.push(label.state)
    if (label.incomingHop) {
      hops.push(label.incomingHop)
      for (const owner of label.incomingHop.owners ?? []) owners.add(owner)
    }
    label = label.parent
  }

  return {
    found: true,
    states: states.reverse(),
    hops: hops.reverse(),
    owners,
    distance: goal.distance,
    expandedLabelCount,
  }
}

/**
 * Finds a short relaxed path while charging for committed blockers. Unlike
 * minimum-distinct-owner search, this keeps one best cost per topology state,
 * so blocker discovery cannot grow exponentially with owner combinations.
 */
export const findBlockerAwarePath = <
  TState,
  TStateKey,
  TOwner,
  THopData = unknown,
>(
  options: BlockerAwarePathSearchOptions<TState, TStateKey, TOwner, THopData>,
): DistinctOwnerBlockerSearchResult<TState, TOwner, THopData> => {
  const maxExpandedLabels =
    options.maxExpandedLabels ?? Number.POSITIVE_INFINITY
  if (
    maxExpandedLabels !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxExpandedLabels) || maxExpandedLabels < 0)
  ) {
    throw new Error("maxExpandedLabels must be a non-negative integer")
  }
  if (
    !Number.isFinite(options.blockerCrossingPenalty) ||
    options.blockerCrossingPenalty < 0
  ) {
    throw new Error("blockerCrossingPenalty must be finite and >= 0")
  }

  const queue = new MinHeap<
    BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData>
  >([], compareBlockerAwarePathLabels)
  const bestCostByStateKey = new Map<TStateKey, number>()
  let queueOrder = 0
  let expandedLabelCount = 0
  const startStateKey = options.getStateKey(options.start)
  const startLabel: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopData> =
    {
      state: options.start,
      stateKey: startStateKey,
      cost: 0,
      distance: 0,
      estimatedCost: getDistanceHeuristic(options.start, options),
      parent: null,
      incomingHop: null,
      queueOrder: queueOrder++,
    }
  bestCostByStateKey.set(startStateKey, 0)
  queue.queue(startLabel)

  while (queue.length > 0) {
    const current = queue.dequeue()!
    if (current.cost !== bestCostByStateKey.get(current.stateKey)) continue
    if (options.isGoal(current.state)) {
      return reconstructBlockerAwarePath(current, expandedLabelCount)
    }
    if (expandedLabelCount >= maxExpandedLabels) {
      return { found: false, reason: "expansion_limit", expandedLabelCount }
    }
    expandedLabelCount++

    for (const hop of options.getHops(current.state)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error("Blocker-aware path hops require finite distances >= 0")
      }
      const nextCost =
        current.cost +
        hop.distance +
        (hop.owners?.length ?? 0) * options.blockerCrossingPenalty
      const nextStateKey = options.getStateKey(hop.state)
      if (nextCost >= (bestCostByStateKey.get(nextStateKey) ?? Infinity)) {
        continue
      }
      const distance = current.distance + hop.distance
      const nextLabel: BlockerAwarePathLabel<
        TState,
        TStateKey,
        TOwner,
        THopData
      > = {
        state: hop.state,
        stateKey: nextStateKey,
        cost: nextCost,
        distance,
        estimatedCost: nextCost + getDistanceHeuristic(hop.state, options),
        parent: current,
        incomingHop: hop,
        queueOrder: queueOrder++,
      }
      bestCostByStateKey.set(nextStateKey, nextCost)
      queue.queue(nextLabel)
    }
  }

  return { found: false, reason: "no_path", expandedLabelCount }
}
