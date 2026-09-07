import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchOptions,
  DistinctOwnerBlockerSearchResult,
} from "./find-distinct-owner-blocker-path"
import { MinHeap } from "./MinHeap"

type ResourceSearchLabel<TState, TStateKey, TOwner, THopData> = {
  state: TState
  stateKey: TStateKey
  blockerCount: number
  distance: number
  parent?: ResourceSearchLabel<TState, TStateKey, TOwner, THopData>
  incomingHop?: DistinctOwnerBlockerHop<TState, TOwner, THopData>
  queueOrder: number
}

/**
 * Find the path crossing the fewest occupied resources, then minimize its
 * routing cost. Additive resource costs need one label per directed hop;
 * distinct-owner minimization needs potentially exponential owner subsets.
 * Every owner on the returned path is still included in the repair set.
 */
export const findResourceBlockerPath = <
  TState,
  TStateKey,
  TOwner,
  THopData = unknown,
>(
  options: DistinctOwnerBlockerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >,
): DistinctOwnerBlockerSearchResult<TState, TOwner, THopData> => {
  const maxExpandedLabels =
    options.maxExpandedLabels ?? Number.POSITIVE_INFINITY
  if (
    maxExpandedLabels !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxExpandedLabels) || maxExpandedLabels < 0)
  ) {
    throw new Error("maxExpandedLabels must be a non-negative integer")
  }

  type Label = ResourceSearchLabel<TState, TStateKey, TOwner, THopData>
  const bestLabelByState = new Map<TStateKey, Label>()
  const queue = new MinHeap<Label>(
    [],
    (left, right) =>
      left.blockerCount - right.blockerCount ||
      left.distance - right.distance ||
      left.queueOrder - right.queueOrder,
  )
  let nextQueueOrder = 0
  let expandedLabelCount = 0
  const startLabel: Label = {
    state: options.start,
    stateKey: options.getStateKey(options.start),
    blockerCount: 0,
    distance: 0,
    queueOrder: nextQueueOrder++,
  }
  bestLabelByState.set(startLabel.stateKey, startLabel)
  queue.queue(startLabel)

  while (queue.length > 0) {
    const current = queue.dequeue()!
    if (bestLabelByState.get(current.stateKey) !== current) continue
    if (options.isGoal(current.state)) {
      const states: TState[] = []
      const hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopData>> = []
      const owners = new Set<TOwner>()
      let cursor: Label | undefined = current
      while (cursor) {
        states.push(cursor.state)
        if (cursor.incomingHop) {
          hops.push(cursor.incomingHop)
          for (const owner of cursor.incomingHop.owners ?? []) {
            owners.add(owner)
          }
        }
        cursor = cursor.parent
      }
      return {
        found: true,
        states: states.reverse(),
        hops: hops.reverse(),
        owners,
        distance: current.distance,
        expandedLabelCount,
      }
    }
    if (expandedLabelCount >= maxExpandedLabels) {
      return { found: false, reason: "expansion_limit", expandedLabelCount }
    }
    expandedLabelCount++

    for (const hop of options.getHops(current.state)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error("Resource blocker hops require finite distances >= 0")
      }
      const stateKey = options.getStateKey(hop.state)
      const blockerCount = current.blockerCount + (hop.owners?.length ?? 0)
      const distance = current.distance + hop.distance
      if (!Number.isFinite(distance)) {
        throw new Error("Resource blocker path distance overflowed")
      }
      const previous = bestLabelByState.get(stateKey)
      if (
        previous &&
        (previous.blockerCount < blockerCount ||
          (previous.blockerCount === blockerCount &&
            previous.distance <= distance))
      ) {
        continue
      }
      const candidate: Label = {
        state: hop.state,
        stateKey,
        blockerCount,
        distance,
        parent: current,
        incomingHop: hop,
        queueOrder: nextQueueOrder++,
      }
      bestLabelByState.set(stateKey, candidate)
      queue.queue(candidate)
    }
  }
  return { found: false, reason: "no_path", expandedLabelCount }
}
