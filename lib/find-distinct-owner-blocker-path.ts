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
    label?: { distance: number; owners: readonly TOwner[] },
  ) => Iterable<DistinctOwnerBlockerHop<TState, TOwner, THopData>>
  maxExpandedLabels?: number
  /** Reject disconnected graphs before enumerating owner sets. Hops must be stable during the search. */
  checkReachability?: boolean
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
  owners: TOwner[]
  distance: number
  parent: SearchLabel<TState, TStateKey, TOwner, THopData> | null
  incomingHop: DistinctOwnerBlockerHop<TState, TOwner, THopData> | null
  queueOrder: number
  active: boolean
}

const compareLabelDistances = <TState, TStateKey, TOwner, THopData>(
  left: SearchLabel<TState, TStateKey, TOwner, THopData>,
  right: SearchLabel<TState, TStateKey, TOwner, THopData>,
): number => {
  const difference = left.distance - right.distance
  return difference !== 0 ? difference : left.queueOrder - right.queueOrder
}

class SearchLabelQueue<TState, TStateKey, TOwner, THopData> {
  // Owner cardinality is an integer primary key. Separate distance heaps avoid
  // comparing owner sets on every sift and keep the original stable ordering.
  private readonly heaps: Array<Array<
    SearchLabel<TState, TStateKey, TOwner, THopData>
  > | undefined> = []
  private minimumOwnerCount = 0

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    const ownerCount = label.owners.length
    const heap = this.heaps[ownerCount] ?? (this.heaps[ownerCount] = [])
    if (ownerCount < this.minimumOwnerCount) this.minimumOwnerCount = ownerCount
    let index = heap.length
    heap.push(label)
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parent = heap[parentIndex]!
      if (compareLabelDistances(parent, label) <= 0) break
      heap[index] = parent
      index = parentIndex
    }
    heap[index] = label
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    while (this.minimumOwnerCount < this.heaps.length &&
      !this.heaps[this.minimumOwnerCount]?.length) this.minimumOwnerCount++
    const heap = this.heaps[this.minimumOwnerCount]
    if (!heap?.length) return null
    const first = heap[0]!
    const last = heap.pop()!
    const length = heap.length
    if (length === 0) return first
    let index = 0
    while (true) {
      const leftIndex = index * 2 + 1
      if (leftIndex >= length) break
      const rightIndex = leftIndex + 1
      const childIndex = rightIndex < length &&
        compareLabelDistances(heap[rightIndex]!, heap[leftIndex]!) < 0
          ? rightIndex : leftIndex
      const child = heap[childIndex]!
      if (compareLabelDistances(last, child) <= 0) break
      heap[index] = child
      index = childIndex
    }
    heap[index] = last
    return first
  }
}

const isOwnerSubset = <TOwner>(
  possibleSubset: readonly TOwner[],
  possibleSuperset: readonly TOwner[],
): boolean => {
  if (possibleSubset.length > possibleSuperset.length) return false
  for (const owner of possibleSubset) {
    if (!possibleSuperset.includes(owner)) return false
  }

  return true
}

const isOwnerSubsetOfUnion = <TOwner>(
  subset: readonly TOwner[],
  existing: readonly TOwner[],
  added: readonly TOwner[],
): boolean => {
  if (subset === existing) return true
  if (subset.length > existing.length + added.length) return false
  for (const owner of subset) {
    if (!existing.includes(owner) && !added.includes(owner)) return false
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

const findDisconnectedSearch = <TState, TStateKey, TOwner, THopData>(
  options: DistinctOwnerBlockerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >,
  maxExpandedStates: number,
): DistinctOwnerBlockerSearchFailure | undefined => {
  const queue = [options.start]
  const seenStateKeys = new Set([options.getStateKey(options.start)])
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
      const stateKey = options.getStateKey(hop.state)
      if (seenStateKeys.has(stateKey)) continue
      seenStateKeys.add(stateKey)
      queue.push(hop.state)
    }
  }

  return {
    found: false,
    reason: "no_path",
    expandedLabelCount: expandedStateCount,
  }
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

  if (options.checkReachability) {
    const disconnected = findDisconnectedSearch(options, maxExpandedLabels)
    if (disconnected) return disconnected
  }

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
    owners: [],
    distance: 0,
    parent: null,
    incomingHop: null,
    queueOrder: nextQueueOrder++,
    active: true,
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

    for (const hop of options.getHops(current.state, current)) {
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
        if (owners.includes(owner)) continue
        if (owners === current.owners) owners = [...current.owners]
        owners.push(owner)
      }
      const candidate: SearchLabel<TState, TStateKey, TOwner, THopData> = {
        state: hop.state,
        stateKey,
        owners,
        distance,
        parent: current,
        incomingHop: hop,
        queueOrder,
        active: true,
      }

      const survivingLabels: Array<
        SearchLabel<TState, TStateKey, TOwner, THopData>
      > = []
      for (const label of existingLabels) {
        if (labelDominates(candidate, label)) {
          label.active = false
        } else {
          survivingLabels.push(label)
        }
      }
      survivingLabels.push(candidate)
      labelsByStateKey.set(candidate.stateKey, survivingLabels)
      queue.push(candidate)
    }
  }
}
