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
  THopMetadata = unknown,
> = Omit<
  DistinctOwnerBlockerSearchOptions<TState, TStateKey, TOwner, THopMetadata>,
  "checkReachability"
> & {
  getDistanceHeuristic?: (state: TState) => number
  blockerCrossingPenalty: number
}

type BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata> = {
  state: TState
  stateKey: TStateKey
  blockerCrossingCount: number
  cost: number
  distance: number
  remainingDistanceLowerBound: number
  parent: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata> | null
  incomingHop: DistinctOwnerBlockerHop<TState, TOwner, THopMetadata> | null
  queueOrder: number
}

const compareBlockerAwarePathLabels = <
  TState,
  TStateKey,
  TOwner,
  THopMetadata,
>(
  left: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>,
  right: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>,
): number => {
  const estimatedCostDifference =
    left.cost +
    left.remainingDistanceLowerBound -
    (right.cost + right.remainingDistanceLowerBound)
  if (estimatedCostDifference !== 0) return estimatedCostDifference

  const blockerCrossingCountDifference =
    left.blockerCrossingCount - right.blockerCrossingCount
  if (blockerCrossingCountDifference !== 0) {
    return blockerCrossingCountDifference
  }

  return left.queueOrder - right.queueOrder
}

class BlockerAwarePathQueue<TState, TStateKey, TOwner, THopMetadata> {
  private readonly items: Array<
    BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>
  > = []

  private readonly queuedIndexByStateKey = new Map<TStateKey, number>()

  upsert(
    label: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>,
  ): void {
    const existingIndex = this.queuedIndexByStateKey.get(label.stateKey)
    if (existingIndex !== undefined) {
      const existingLabel = this.items[existingIndex]!
      this.items[existingIndex] = label
      if (compareBlockerAwarePathLabels(label, existingLabel) <= 0) {
        this.siftUp(existingIndex)
      } else {
        this.siftDown(existingIndex)
      }
      return
    }

    const index = this.items.length
    this.items.push(label)
    this.siftUp(index)
  }

  dequeue():
    | BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>
    | undefined {
    const bestLabel = this.items[0]
    if (!bestLabel) return undefined

    this.queuedIndexByStateKey.delete(bestLabel.stateKey)
    const lastLabel = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastLabel
      this.siftDown(0)
    }
    return bestLabel
  }

  private siftUp(startIndex: number): void {
    const label = this.items[startIndex]!
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parent = this.items[parentIndex]!
      if (compareBlockerAwarePathLabels(parent, label) <= 0) break
      this.items[index] = parent
      this.queuedIndexByStateKey.set(parent.stateKey, index)
      index = parentIndex
    }
    this.items[index] = label
    this.queuedIndexByStateKey.set(label.stateKey, index)
  }

  private siftDown(startIndex: number): void {
    const label = this.items[startIndex]!
    let index = startIndex
    while (true) {
      const leftChildIndex = index * 2 + 1
      if (leftChildIndex >= this.items.length) break
      const rightChildIndex = leftChildIndex + 1
      const bestChildIndex =
        rightChildIndex < this.items.length &&
        compareBlockerAwarePathLabels(
          this.items[rightChildIndex]!,
          this.items[leftChildIndex]!,
        ) < 0
          ? rightChildIndex
          : leftChildIndex
      const bestChild = this.items[bestChildIndex]!
      if (compareBlockerAwarePathLabels(label, bestChild) <= 0) break
      this.items[index] = bestChild
      this.queuedIndexByStateKey.set(bestChild.stateKey, index)
      index = bestChildIndex
    }
    this.items[index] = label
    this.queuedIndexByStateKey.set(label.stateKey, index)
  }
}

const getDistanceHeuristicOrThrow = <
  TState,
  TStateKey,
  TOwner,
  THopMetadata,
>(
  state: TState,
  options: BlockerAwarePathSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopMetadata
  >,
): number => {
  const remainingDistanceLowerBound = options.getDistanceHeuristic?.(state) ?? 0
  if (
    !Number.isFinite(remainingDistanceLowerBound) ||
    remainingDistanceLowerBound < 0
  ) {
    throw new Error(
      "Blocker-aware path distance heuristics must be finite and >= 0",
    )
  }
  return remainingDistanceLowerBound
}

const reconstructBlockerAwarePath = <
  TState,
  TStateKey,
  TOwner,
  THopMetadata,
>(
  goal: BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>,
  expandedLabelCount: number,
): DistinctOwnerBlockerSearchSuccess<TState, TOwner, THopMetadata> => {
  const states: TState[] = []
  const hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopMetadata>> = []
  const owners = new Set<TOwner>()
  let cursor:
    | BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>
    | null = goal
  while (cursor !== null) {
    states.push(cursor.state)
    if (cursor.incomingHop !== null) {
      hops.push(cursor.incomingHop)
      for (const owner of cursor.incomingHop.owners ?? []) owners.add(owner)
    }
    cursor = cursor.parent
  }

  states.reverse()
  hops.reverse()
  return {
    found: true,
    states,
    hops,
    owners,
    distance: goal.distance,
    expandedLabelCount,
  }
}

/**
 * Finds a short relaxed path while charging for every committed blocker it
 * crosses. One queued label per topology state bounds memory independently of
 * the number of distinct blocker-owner combinations in the graph.
 */
export const findBlockerAwarePath = <
  TState,
  TStateKey,
  TOwner,
  THopMetadata = unknown,
>(
  options: BlockerAwarePathSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopMetadata
  >,
): DistinctOwnerBlockerSearchResult<TState, TOwner, THopMetadata> => {
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

  const queue = new BlockerAwarePathQueue<
    TState,
    TStateKey,
    TOwner,
    THopMetadata
  >()
  const bestLabelByStateKey = new Map<
    TStateKey,
    BlockerAwarePathLabel<TState, TStateKey, TOwner, THopMetadata>
  >()
  let nextQueueOrder = 0
  let expandedLabelCount = 0
  const startLabel: BlockerAwarePathLabel<
    TState,
    TStateKey,
    TOwner,
    THopMetadata
  > = {
    state: options.start,
    stateKey: options.getStateKey(options.start),
    blockerCrossingCount: 0,
    cost: 0,
    distance: 0,
    remainingDistanceLowerBound: getDistanceHeuristicOrThrow(
      options.start,
      options,
    ),
    parent: null,
    incomingHop: null,
    queueOrder: nextQueueOrder++,
  }
  bestLabelByStateKey.set(startLabel.stateKey, startLabel)
  queue.upsert(startLabel)

  while (true) {
    const current = queue.dequeue()
    if (!current) {
      return { found: false, reason: "no_path", expandedLabelCount }
    }
    if (options.isGoal(current.state)) {
      return reconstructBlockerAwarePath(current, expandedLabelCount)
    }
    if (expandedLabelCount >= maxExpandedLabels) {
      return { found: false, reason: "expansion_limit", expandedLabelCount }
    }
    expandedLabelCount++

    for (const hop of options.getHops(current.state)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error(
          "Blocker-aware path hops require finite distances >= 0",
        )
      }
      const blockerCrossingCount =
        current.blockerCrossingCount + (hop.owners?.length ?? 0)
      const distance = current.distance + hop.distance
      const cost =
        current.cost +
        hop.distance +
        (hop.owners?.length ?? 0) * options.blockerCrossingPenalty
      if (!Number.isFinite(distance) || !Number.isFinite(cost)) {
        throw new Error("Blocker-aware path cost overflowed")
      }
      const stateKey = options.getStateKey(hop.state)
      const existingLabel = bestLabelByStateKey.get(stateKey)
      if (
        existingLabel &&
        (existingLabel.cost < cost ||
          (existingLabel.cost === cost &&
            existingLabel.blockerCrossingCount <= blockerCrossingCount))
      ) {
        continue
      }

      const candidate: BlockerAwarePathLabel<
        TState,
        TStateKey,
        TOwner,
        THopMetadata
      > = {
        state: hop.state,
        stateKey,
        blockerCrossingCount,
        cost,
        distance,
        remainingDistanceLowerBound: getDistanceHeuristicOrThrow(
          hop.state,
          options,
        ),
        parent: current,
        incomingHop: hop,
        queueOrder: nextQueueOrder++,
      }
      bestLabelByStateKey.set(stateKey, candidate)
      queue.upsert(candidate)
    }
  }
}
