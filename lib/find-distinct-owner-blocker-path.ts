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
  /** Equivalent unweighted traversal; may omit destinations already discovered. */
  getReachabilityHops?: (
    state: TState,
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

/** Nonnegative path lengths are monotone within an owner-cardinality bucket. */
class DistanceRadixQueue<TState, TStateKey, TOwner, THopData> {
  private buckets: Array<
    Array<SearchLabel<TState, TStateKey, TOwner, THopData>> | undefined
  > = []
  private readonly bits = new DataView(new ArrayBuffer(8))
  private lastHigh = 0
  private lastLow = 0
  private zeroHead = 0
  length = 0

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    this.bits.setFloat64(0, label.distance)
    const high = (this.bits.getUint32(0) ^ this.lastHigh) >>> 0
    const low = (this.bits.getUint32(4) ^ this.lastLow) >>> 0
    const index = high ? 64 - Math.clz32(high) : low ? 32 - Math.clz32(low) : 0
    const bucket = this.buckets[index] ?? (this.buckets[index] = [])
    bucket.push(label)
    this.length++
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    const zero = this.buckets[0]
    if (zero && this.zeroHead < zero.length) {
      const label = zero[this.zeroHead++]!
      this.length--
      if (this.zeroHead === zero.length) {
        zero.length = 0
        this.zeroHead = 0
      }
      return label
    }
    let index = 1
    while (index < this.buckets.length && !this.buckets[index]?.length) index++
    const bucket = this.buckets[index]
    if (!bucket?.length) return null
    let minimum = Infinity
    for (const label of bucket)
      if (label.distance < minimum) minimum = label.distance
    this.bits.setFloat64(0, minimum)
    this.lastHigh = this.bits.getUint32(0)
    this.lastLow = this.bits.getUint32(4)
    this.buckets[index] = undefined
    this.length -= bucket.length
    // Lower buckets are empty. Stable redistribution retains queue insertion
    // order for equal distances, including labels added while processing ties.
    for (const label of bucket) this.push(label)
    return this.pop()
  }
}

class DistanceLabelQueue<TState, TStateKey, TOwner, THopData> {
  private items: Array<SearchLabel<TState, TStateKey, TOwner, THopData>> = []
  private radix?: DistanceRadixQueue<TState, TStateKey, TOwner, THopData>

  get length(): number {
    return this.radix ? this.radix.length : this.items.length
  }

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    if (this.radix) {
      this.radix.push(label)
      return
    }
    const heap = this.items
    let index = heap.length
    heap.push(label)
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parent = heap[parentIndex]!
      if (
        parent.distance < label.distance ||
        (parent.distance === label.distance &&
          parent.queueOrder < label.queueOrder)
      )
        break
      heap[index] = parent
      index = parentIndex
    }
    heap[index] = label
    if (heap.length >= 128) {
      this.radix = new DistanceRadixQueue()
      // The binary heap permutes ties. Restore insertion order before stable
      // radix redistribution so migration cannot change selected paths.
      heap.sort((left, right) => left.queueOrder - right.queueOrder)
      for (const item of heap) this.radix.push(item)
      this.items = []
    }
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    if (this.radix) return this.radix.pop()
    const heap = this.items
    const first = heap[0]
    const last = heap.pop()
    if (!first || !last) return null
    const length = heap.length
    if (length === 0) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= length) break
      const right = left + 1
      const smaller =
        right < length &&
        (heap[right]!.distance < heap[left]!.distance ||
          (heap[right]!.distance === heap[left]!.distance &&
            heap[right]!.queueOrder < heap[left]!.queueOrder))
          ? right
          : left
      const child = heap[smaller]!
      if (
        last.distance < child.distance ||
        (last.distance === child.distance && last.queueOrder < child.queueOrder)
      )
        break
      heap[index] = child
      index = smaller
    }
    heap[index] = last
    return first
  }
}

class SearchLabelQueue<TState, TStateKey, TOwner, THopData> {
  private readonly heaps: Array<
    DistanceLabelQueue<TState, TStateKey, TOwner, THopData> | undefined
  > = []
  private minimumOwnerCount = 0

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    const ownerCount = label.owners.length
    const heap =
      this.heaps[ownerCount] ??
      (this.heaps[ownerCount] = new DistanceLabelQueue())
    if (ownerCount < this.minimumOwnerCount) this.minimumOwnerCount = ownerCount
    heap.push(label)
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    while (
      this.minimumOwnerCount < this.heaps.length &&
      !this.heaps[this.minimumOwnerCount]?.length
    )
      this.minimumOwnerCount++
    return this.heaps[this.minimumOwnerCount]?.pop() ?? null
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

    for (const hop of (options.getReachabilityHops ?? options.getHops)(state)) {
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

  type Label = SearchLabel<TState, TStateKey, TOwner, THopData>
  type StateLabels = {
    multi: Label[]
    empty: Label | undefined
    singles: Map<TOwner, Label>
  }
  const labelsByStateKey = new Map<TStateKey, StateLabels>()
  const singletonOwners = new Map<TOwner, TOwner[]>()
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
  labelsByStateKey.set(startLabel.stateKey, {
    multi: [],
    empty: startLabel,
    singles: new Map(),
  })
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
      let entry = labelsByStateKey.get(stateKey)
      const existingLabels = entry?.multi ?? []
      const addedOwners = hop.owners ?? []
      if (entry?.empty && entry.empty.distance <= distance) continue

      // Zero/single-owner labels dominate only their own owner class (or the
      // empty class). Most rejected proposals need no Pareto-frontier scan.
      let category = Math.min(2, current.owners.length)
      let singleOwner = current.owners[0]!
      if (category === 0 && addedOwners.length > 0) {
        singleOwner = addedOwners[0]!
        category = 1
      }
      if (category === 1) {
        for (const owner of addedOwners) {
          if (
            owner !== singleOwner &&
            !(owner !== owner && singleOwner !== singleOwner)
          ) {
            category = 2
            break
          }
        }
      }
      let dominated = false
      if (category === 1) {
        const single = entry?.singles.get(singleOwner)
        dominated = single !== undefined && single.distance <= distance
      } else if (category > 1) {
        if (entry) {
          for (const owner of current.owners) {
            const single = entry.singles.get(owner)
            if (single !== undefined && single.distance <= distance) {
              dominated = true
              break
            }
          }
          if (!dominated)
            for (const owner of addedOwners) {
              const single = entry.singles.get(owner)
              if (single !== undefined && single.distance <= distance) {
                dominated = true
                break
              }
            }
        }
        if (!dominated)
          for (const label of existingLabels) {
            if (
              label.distance <= distance &&
              isOwnerSubsetOfUnion(label.owners, current.owners, addedOwners)
            ) {
              dominated = true
              break
            }
          }
      }
      if (dominated) continue

      let owners = current.owners
      if (category === 1 && current.owners.length === 0) {
        let singleton = singletonOwners.get(singleOwner)
        if (!singleton) {
          singleton = [singleOwner]
          singletonOwners.set(singleOwner, singleton)
        }
        owners = singleton
      } else if (category > 1) {
        for (const owner of addedOwners) {
          if (owners.includes(owner)) continue
          if (owners === current.owners) owners = [...current.owners]
          owners.push(owner)
        }
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

      if (!entry) {
        entry = { multi: existingLabels, empty: undefined, singles: new Map() }
        labelsByStateKey.set(stateKey, entry)
      }
      let kept = 0
      for (const label of existingLabels) {
        if (labelDominates(candidate, label)) label.active = false
        else existingLabels[kept++] = label
      }
      existingLabels.length = kept
      if (owners.length === 0) {
        if (entry.empty) entry.empty.active = false
        entry.empty = candidate
        for (const [owner, label] of entry.singles) {
          if (distance <= label.distance) {
            label.active = false
            entry.singles.delete(owner)
          }
        }
      } else if (owners.length === 1) {
        const previous = entry.singles.get(owners[0]!)
        if (previous) previous.active = false
        entry.singles.set(owners[0]!, candidate)
      } else {
        existingLabels.push(candidate)
      }
      queue.push(candidate)
    }
  }
}
