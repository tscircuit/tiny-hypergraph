export type DistinctOwnerBlockerHop<TState, TOwner, THopData = unknown> = {
  state: TState
  distance: number
  owners?: readonly TOwner[]
  data?: THopData
}

export type DistinctOwnerBlockerSearchOptions<
  TState,
  TStateKey,
  TOwner,
  THopData = unknown,
> = {
  start: TState
  getStateKey: (state: TState) => TStateKey
  isGoal: (state: TState) => boolean
  getHops: (
    state: TState,
  ) => Iterable<DistinctOwnerBlockerHop<TState, TOwner, THopData>>
  maxExpandedLabels?: number
  /** Requires a finite fixed graph; may visit hops before weighted expansion. */
  certifyMinimumOwnerCount?: boolean
  /** Optional reduction preserving exactly the same owner-free goal reachability. */
  getOwnerFreeReachabilityHops?: (
    state: TState,
  ) => Iterable<DistinctOwnerBlockerHop<TState, TOwner, THopData>>
}

export type DistinctOwnerBlockerSearchSuccess<
  TState,
  TOwner,
  THopData = unknown,
> = {
  found: true
  states: TState[]
  hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopData>>
  owners: ReadonlySet<TOwner>
  distance: number
  expandedLabelCount: number
}

export type DistinctOwnerBlockerSearchFailure = {
  found: false
  reason: "no_path" | "expansion_limit"
  expandedLabelCount: number
}

export type DistinctOwnerBlockerSearchResult<
  TState,
  TOwner,
  THopData = unknown,
> =
  | DistinctOwnerBlockerSearchSuccess<TState, TOwner, THopData>
  | DistinctOwnerBlockerSearchFailure

type SearchLabel<TState, TStateKey, TOwner, THopData> = {
  state: TState
  stateKey: TStateKey
  owners: Set<TOwner>
  priorityOwnerCount: number
  distance: number
  parent: SearchLabel<TState, TStateKey, TOwner, THopData> | null
  incomingHop: DistinctOwnerBlockerHop<TState, TOwner, THopData> | null
  queueOrder: number
  active: boolean
  queueIndex: number
}

const compareLabels = <TState, TStateKey, TOwner, THopData>(
  left: SearchLabel<TState, TStateKey, TOwner, THopData>,
  right: SearchLabel<TState, TStateKey, TOwner, THopData>,
): number => {
  const ownerCountDifference = left.priorityOwnerCount - right.priorityOwnerCount
  if (ownerCountDifference !== 0) return ownerCountDifference

  const distanceDifference = left.distance - right.distance
  if (distanceDifference !== 0) return distanceDifference

  return left.queueOrder - right.queueOrder
}

class SearchLabelQueue<TState, TStateKey, TOwner, THopData> {
  private readonly heap: Array<
    SearchLabel<TState, TStateKey, TOwner, THopData>
  > = []

  private siftUp(index: number): void {
    const label = this.heap[index]!
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.heap[parentIndex]!
      if (compareLabels(parent, label) <= 0) break
      this.heap[index] = parent
      parent.queueIndex = index
      index = parentIndex
    }
    this.heap[index] = label
    label.queueIndex = index
  }

  private siftDown(index: number): void {
    const label = this.heap[index]!
    while (true) {
      const leftIndex = index * 2 + 1
      if (leftIndex >= this.heap.length) break
      const rightIndex = leftIndex + 1
      const bestIndex =
        rightIndex < this.heap.length &&
        compareLabels(this.heap[rightIndex]!, this.heap[leftIndex]!) < 0
          ? rightIndex
          : leftIndex
      const child = this.heap[bestIndex]!
      if (compareLabels(child, label) >= 0) break
      this.heap[index] = child
      child.queueIndex = index
      index = bestIndex
    }
    this.heap[index] = label
    label.queueIndex = index
  }

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    if (label.queueIndex !== -1) {
      throw new Error("Blocker label is already queued")
    }
    label.queueIndex = this.heap.length
    this.heap.push(label)
    this.siftUp(label.queueIndex)
  }

  replaceDominated(
    previous: SearchLabel<TState, TStateKey, TOwner, THopData>,
    candidate: SearchLabel<TState, TStateKey, TOwner, THopData>,
  ): void {
    const index = previous.queueIndex
    if (
      index < 0 ||
      this.heap[index] !== previous ||
      candidate.queueIndex !== -1
    ) {
      throw new Error("Invalid dominated blocker label replacement")
    }
    previous.queueIndex = -1
    candidate.queueIndex = index
    this.heap[index] = candidate
    // A certified owner floor can give fewer-owner labels the same priority.
    // Their later queueOrder can move the replacement down rather than up.
    if (
      index > 0 &&
      compareLabels(candidate, this.heap[Math.floor((index - 1) / 2)]!) < 0
    ) {
      this.siftUp(index)
    } else {
      this.siftDown(index)
    }
  }

  remove(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    const index = label.queueIndex
    if (index < 0 || this.heap[index] !== label) {
      throw new Error("Blocker label queue index is inconsistent")
    }
    const last = this.heap.pop()!
    label.queueIndex = -1
    if (last === label) return
    this.heap[index] = last
    last.queueIndex = index
    if (
      index > 0 &&
      compareLabels(last, this.heap[Math.floor((index - 1) / 2)]!) < 0
    ) {
      this.siftUp(index)
    } else {
      this.siftDown(index)
    }
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    const first = this.heap[0]
    if (!first) {
      return null
    }
    this.remove(first)
    return first
  }
}

const isOwnerSubset = <TOwner>(
  possibleSubset: ReadonlySet<TOwner>,
  possibleSuperset: ReadonlySet<TOwner>,
): boolean => {
  if (possibleSubset.size > possibleSuperset.size) return false
  for (const owner of possibleSubset) {
    if (!possibleSuperset.has(owner)) return false
  }

  return true
}

const isOwnerSubsetOfUnion = <TOwner>(
  subset: ReadonlySet<TOwner>,
  existing: ReadonlySet<TOwner>,
  added: readonly TOwner[],
): boolean => {
  if (subset === existing) return true
  if (subset.size > existing.size + added.length) return false
  for (const owner of subset) {
    if (!existing.has(owner) && !added.includes(owner)) return false
  }
  return true
}

const labelDominates = <TState, TStateKey, TOwner, THopData>(
  left: SearchLabel<TState, TStateKey, TOwner, THopData>,
  right: SearchLabel<TState, TStateKey, TOwner, THopData>,
): boolean => {
  if (left.distance > right.distance) return false
  return isOwnerSubset(left.owners, right.owners)
}

const reconstructSuccessfulSearch = <TState, TStateKey, TOwner, THopData>(
  goal: SearchLabel<TState, TStateKey, TOwner, THopData>,
  expandedLabelCount: number,
): DistinctOwnerBlockerSearchSuccess<TState, TOwner, THopData> => {
  const states: TState[] = []
  const hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopData>> = []
  let cursor: SearchLabel<TState, TStateKey, TOwner, THopData> | null = goal
  while (cursor !== null) {
    states.push(cursor.state)
    if (cursor.incomingHop !== null) hops.push(cursor.incomingHop)
    cursor = cursor.parent
  }

  states.reverse()
  hops.reverse()
  return {
    found: true,
    states,
    hops,
    owners: new Set(goal.owners),
    distance: goal.distance,
    expandedLabelCount,
  }
}

const getNextActiveLabel = <TState, TStateKey, TOwner, THopData>(
  queue: SearchLabelQueue<TState, TStateKey, TOwner, THopData>,
): SearchLabel<TState, TStateKey, TOwner, THopData> | null => {
  while (true) {
    const label = queue.pop()
    if (label === null) return null
    if (label.active) return label
  }
}

const certifyMinimumOwnerCount = <TState, TStateKey, TOwner, THopData>(
  options: DistinctOwnerBlockerSearchOptions<TState, TStateKey, TOwner, THopData>,
): 0 | 1 => {
  const visited = new Set<TStateKey>([options.getStateKey(options.start)])
  const pending: TState[] = [options.start]
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor]!
    if (options.isGoal(current)) return 0
    for (const hop of (options.getOwnerFreeReachabilityHops ?? options.getHops)(current)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error(
          "Distinct-owner blocker hops require finite distances >= 0",
        )
      }
      if (hop.owners !== undefined && hop.owners.length !== 0) continue
      const key = options.getStateKey(hop.state)
      if (visited.has(key)) continue
      visited.add(key)
      pending.push(hop.state)
    }
  }
  // Exhausting owner-free reachability proves every solution needs an owner.
  // This does not replace the weighted labels or consume their expansion limit.
  return 1
}

export const findDistinctOwnerBlockerPath = <
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

  const minimumOwnerCount =
    options.certifyMinimumOwnerCount && maxExpandedLabels !== 0
      ? certifyMinimumOwnerCount(options)
      : 0
  const labelsByStateKey = new Map<
    TStateKey,
    Array<SearchLabel<TState, TStateKey, TOwner, THopData>>
  >()
  const queue = new SearchLabelQueue<TState, TStateKey, TOwner, THopData>()
  let nextQueueOrder = 0
  let expandedLabelCount = 0
  const startLabel: SearchLabel<TState, TStateKey, TOwner, THopData> = {
    state: options.start,
    stateKey: options.getStateKey(options.start),
    owners: new Set<TOwner>(),
    priorityOwnerCount: minimumOwnerCount,
    distance: 0,
    parent: null,
    incomingHop: null,
    queueOrder: nextQueueOrder++,
    active: true,
    queueIndex: -1,
  }
  labelsByStateKey.set(startLabel.stateKey, [startLabel])
  queue.push(startLabel)

  while (true) {
    const current = getNextActiveLabel(queue)
    if (current === null) {
      return { found: false, reason: "no_path", expandedLabelCount }
    }
    if (options.isGoal(current.state)) {
      return reconstructSuccessfulSearch(current, expandedLabelCount)
    }
    if (expandedLabelCount >= maxExpandedLabels) {
      return { found: false, reason: "expansion_limit", expandedLabelCount }
    }
    expandedLabelCount++

    for (const hop of options.getHops(current.state)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error(
          "Distinct-owner blocker hops require finite distances >= 0",
        )
      }

      const distance = current.distance + hop.distance
      if (!Number.isFinite(distance)) {
        throw new Error("Distinct-owner blocker path distance overflowed")
      }
      const stateKey = options.getStateKey(hop.state)
      const queueOrder = nextQueueOrder++
      const existingLabels = labelsByStateKey.get(stateKey) ?? []
      const addedOwners = hop.owners ?? []
      // Most proposed labels are dominated. Test the owner union without
      // allocating a label or copying its owner set for those rejected hops.
      let dominated = false
      for (const label of existingLabels) {
        if (
          label.distance <= distance &&
          isOwnerSubsetOfUnion(label.owners, current.owners, addedOwners)
        ) {
          dominated = true
          break
        }
      }
      if (dominated) continue

      // Labels never mutate their owner set after entering the queue. Most
      // hops encounter no new owner, so share the set until it changes.
      let owners = current.owners
      for (const owner of addedOwners) {
        if (owners.has(owner)) continue
        if (owners === current.owners) owners = new Set(current.owners)
        owners.add(owner)
      }
      const candidate: SearchLabel<TState, TStateKey, TOwner, THopData> = {
        state: hop.state,
        stateKey,
        owners,
        priorityOwnerCount: Math.max(owners.size, minimumOwnerCount),
        distance,
        parent: current,
        incomingHop: hop,
        queueOrder,
        active: true,
        queueIndex: -1,
      }

      const survivingLabels: Array<
        SearchLabel<TState, TStateKey, TOwner, THopData>
      > = []
      for (const label of existingLabels) {
        if (labelDominates(candidate, label)) {
          label.active = false
          if (label.queueIndex !== -1) {
            // Replace one dominated queued label and remove the others without
            // retaining stale entries. Routing data in parent labels is unchanged.
            if (candidate.queueIndex === -1) {
              queue.replaceDominated(label, candidate)
            } else {
              queue.remove(label)
            }
          }
        } else {
          survivingLabels.push(label)
        }
      }
      survivingLabels.push(candidate)
      labelsByStateKey.set(candidate.stateKey, survivingLabels)
      if (candidate.queueIndex === -1) queue.push(candidate)
    }
  }
}
