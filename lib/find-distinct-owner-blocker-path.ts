import { findDisconnectedOwnedRelaxedHyperedgeSearch } from "./owned-relaxed-hyperedge-reachability"
import type {
  OwnedRelaxedHyperedgeRow,
  OwnedRelaxedHyperedgeSearchOptions,
  OwnedRelaxedSearchState,
} from "./owned-relaxed-hyperedge-types"

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
  owners: Set<TOwner>
  distance: number
  parent: SearchLabel<TState, TStateKey, TOwner, THopData> | null
  incomingHop: DistinctOwnerBlockerHop<TState, TOwner, THopData> | null
  queueOrder: number
  active: boolean
}

const compareLabels = <TState, TStateKey, TOwner, THopData>(
  left: SearchLabel<TState, TStateKey, TOwner, THopData>,
  right: SearchLabel<TState, TStateKey, TOwner, THopData>,
): number => {
  const ownerCountDifference = left.owners.size - right.owners.size
  if (ownerCountDifference !== 0) return ownerCountDifference

  const distanceDifference = left.distance - right.distance
  if (distanceDifference !== 0) return distanceDifference

  return left.queueOrder - right.queueOrder
}

class SearchLabelQueue<TState, TStateKey, TOwner, THopData> {
  private readonly heap: Array<
    SearchLabel<TState, TStateKey, TOwner, THopData>
  > = []

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    this.heap.push(label)
    let index = this.heap.length - 1

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (compareLabels(this.heap[parentIndex]!, this.heap[index]!) <= 0) {
        break
      }
      ;[this.heap[parentIndex], this.heap[index]] = [
        this.heap[index]!,
        this.heap[parentIndex]!,
      ]
      index = parentIndex
    }
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    const first = this.heap[0]
    const last = this.heap.pop()
    if (!first || !last) return null
    if (this.heap.length === 0) return first

    this.heap[0] = last
    let index = 0
    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      let bestIndex = index
      if (
        leftIndex < this.heap.length &&
        compareLabels(this.heap[leftIndex]!, this.heap[bestIndex]!) < 0
      ) {
        bestIndex = leftIndex
      }
      if (
        rightIndex < this.heap.length &&
        compareLabels(this.heap[rightIndex]!, this.heap[bestIndex]!) < 0
      ) {
        bestIndex = rightIndex
      }
      if (bestIndex === index) break
      ;[this.heap[index], this.heap[bestIndex]] = [
        this.heap[bestIndex]!,
        this.heap[index]!,
      ]
      index = bestIndex
    }

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
    owners: new Set<TOwner>(),
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

type FirstOwnedWitness<TOwner> = {
  distance: number
  owners: ReadonlySet<TOwner>
}

class OwnedHyperedgeNode<TOwner> {
  left?: OwnedHyperedgeNode<TOwner>
  right?: OwnedHyperedgeNode<TOwner>
  maxWitnessDistance = Number.POSITIVE_INFINITY
  requiredOwners?: readonly TOwner[]

  constructor(
    readonly start: number,
    readonly end: number,
    readonly parent?: OwnedHyperedgeNode<TOwner>,
  ) {}
}

const EMPTY_REQUIRED_OWNERS: readonly never[] = []

class OwnedHyperedgeCertificates<TOwner, THopData> {
  private readonly witnesses = new Map<number, FirstOwnedWitness<TOwner>>()
  private readonly trees = new Map<object, OwnedHyperedgeNode<TOwner>>()
  private readonly waiting = new Map<
    number,
    Array<{
      node: OwnedHyperedgeNode<TOwner>
      addedOwners: readonly TOwner[]
    }>
  >()

  constructor(
    private readonly getStateKey: (state: OwnedRelaxedSearchState) => number,
  ) {}

  recordFirstWitness(
    stateKey: number,
    distance: number,
    owners: ReadonlySet<TOwner>,
  ): void {
    const witness = { distance, owners }
    this.witnesses.set(stateKey, witness)
    const leaves = this.waiting.get(stateKey)
    if (leaves === undefined) return
    for (const { node, addedOwners } of leaves) {
      this.resolveLeaf(node, addedOwners, witness)
    }
    this.waiting.delete(stateKey)
  }

  getTree(
    row: OwnedRelaxedHyperedgeRow<TOwner, THopData>,
  ): OwnedHyperedgeNode<TOwner> | undefined {
    if (row.hyperedgeId === undefined || row.templates.length === 0) {
      return undefined
    }
    const cached = this.trees.get(row.hyperedgeId)
    if (cached !== undefined) return cached
    const build = (
      start: number,
      end: number,
      parent?: OwnedHyperedgeNode<TOwner>,
    ): OwnedHyperedgeNode<TOwner> => {
      const node = new OwnedHyperedgeNode<TOwner>(start, end, parent)
      if (end - start === 1) {
        const template = row.templates[start]!
        const key = this.getStateKey(template.state)
        const addedOwners = template.owners ?? EMPTY_REQUIRED_OWNERS
        const witness = this.witnesses.get(key)
        if (witness === undefined) {
          let leaves = this.waiting.get(key)
          if (leaves === undefined) {
            leaves = []
            this.waiting.set(key, leaves)
          }
          leaves.push({ node, addedOwners })
        } else {
          this.resolveLeaf(node, addedOwners, witness)
        }
      } else {
        const middle = Math.floor((start + end) / 2)
        node.left = build(start, middle, node)
        node.right = build(middle, end, node)
        this.resolveParents(node)
      }
      return node
    }
    const root = build(0, row.templates.length)
    this.trees.set(row.hyperedgeId, root)
    return root
  }

  private resolveLeaf(
    node: OwnedHyperedgeNode<TOwner>,
    addedOwners: readonly TOwner[],
    witness: FirstOwnedWitness<TOwner>,
  ): void {
    let residual: TOwner[] | undefined
    for (const owner of witness.owners) {
      if (!addedOwners.includes(owner)) {
        residual ??= []
        residual.push(owner)
      }
    }
    node.requiredOwners = residual ?? EMPTY_REQUIRED_OWNERS
    node.maxWitnessDistance = witness.distance
    if (node.parent !== undefined) this.resolveParents(node.parent)
  }

  private resolveParents(first: OwnedHyperedgeNode<TOwner>): void {
    let node: OwnedHyperedgeNode<TOwner> | undefined = first
    while (node !== undefined && node.requiredOwners === undefined) {
      const left = node.left
      const right = node.right
      if (
        left?.requiredOwners === undefined ||
        right?.requiredOwners === undefined
      ) {
        return
      }
      node.maxWitnessDistance = Math.max(
        left.maxWitnessDistance,
        right.maxWitnessDistance,
      )
      if (left.requiredOwners.length === 0) {
        node.requiredOwners = right.requiredOwners
      } else if (right.requiredOwners.length === 0) {
        node.requiredOwners = left.requiredOwners
      } else {
        const union = [...left.requiredOwners]
        for (const owner of right.requiredOwners) {
          if (!union.includes(owner)) union.push(owner)
        }
        node.requiredOwners = union
      }
      node = node.parent
    }
  }
}

const advanceOwnedQueueOrder = (order: number, count: number): number =>
  Math.min(2 ** 53, order + count)

/**
 * Search stable, explicitly caller-owned regional hyperedges. State keys and
 * goal checks must be pure, deterministic callbacks; all adjacency metadata
 * stays ordinary and fixed throughout the synchronous search.
 */
export const findDistinctOwnerBlockerPathWithOwnedHyperedges = <
  TOwner,
  THopData = unknown,
>(
  options: OwnedRelaxedHyperedgeSearchOptions<TOwner, THopData>,
): DistinctOwnerBlockerSearchResult<
  OwnedRelaxedSearchState,
  TOwner,
  THopData
> => {
  const maxExpandedLabels =
    options.maxExpandedLabels ?? Number.POSITIVE_INFINITY
  if (
    maxExpandedLabels !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxExpandedLabels) || maxExpandedLabels < 0)
  ) {
    throw new Error("maxExpandedLabels must be a non-negative integer")
  }
  if (options.checkReachability) {
    const disconnected = options.finiteCumulativeDistances
      ? findDisconnectedOwnedRelaxedHyperedgeSearch(
          options,
          maxExpandedLabels,
        )
      : findDisconnectedSearch(
          {
            ...options,
            getHops: (state) => {
              const row = options.getRow(state)
              if (row.eagerHops === undefined) {
                throw new Error("Uncertified owned rows require eager hops")
              }
              return row.eagerHops
            },
          },
          maxExpandedLabels,
        )
    if (disconnected) return disconnected
  }

  type Label = SearchLabel<
    OwnedRelaxedSearchState,
    number,
    TOwner,
    THopData
  >
  const labelsByStateKey = new Map<number, Label[]>()
  const queue = new SearchLabelQueue<
    OwnedRelaxedSearchState,
    number,
    TOwner,
    THopData
  >()
  const certificates = new OwnedHyperedgeCertificates<TOwner, THopData>(
    options.getStateKey,
  )
  let nextQueueOrder = 0
  let expandedLabelCount = 0
  const startLabel: Label = {
    state: options.start,
    stateKey: options.getStateKey(options.start),
    owners: new Set<TOwner>(),
    distance: 0,
    parent: null,
    incomingHop: null,
    queueOrder: nextQueueOrder++,
    active: true,
  }
  labelsByStateKey.set(startLabel.stateKey, [startLabel])
  queue.push(startLabel)
  certificates.recordFirstWitness(startLabel.stateKey, 0, startLabel.owners)

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

    const row = options.getRow(current.state)
    const tree = certificates.getTree(row)
    const canSkip =
      options.finiteCumulativeDistances ||
      (row.maxHopDistance !== undefined &&
        Number.isFinite(current.distance + row.maxHopDistance))
    let yieldedIndex = 0
    let excludedIndex = 0
    const relax = (templateIndex: number): void => {
      const hopIndex = yieldedIndex++
      const hop =
        row.getHopDistance === undefined
          ? row.getHop(templateIndex, hopIndex)
          : undefined
      const metadata = hop ?? row.templates[templateIndex]!
      const hopDistance =
        hop === undefined
          ? row.getHopDistance!(templateIndex)
          : hop.distance
      if (!Number.isFinite(hopDistance) || hopDistance < 0) {
        throw new Error(
          "Distinct-owner blocker hops require finite distances >= 0",
        )
      }
      const distance = current.distance + hopDistance
      if (!Number.isFinite(distance)) {
        throw new Error("Distinct-owner blocker path distance overflowed")
      }
      const stateKey = options.getStateKey(metadata.state)
      const queueOrder = nextQueueOrder++
      const existingLabels = labelsByStateKey.get(stateKey) ?? []
      const firstAcceptance = existingLabels.length === 0
      const addedOwners = metadata.owners ?? []
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
      if (dominated) return

      let owners = current.owners
      for (const owner of addedOwners) {
        if (owners.has(owner)) continue
        if (owners === current.owners) owners = new Set(current.owners)
        owners.add(owner)
      }
      const candidate: Label = {
        state: metadata.state,
        stateKey,
        owners,
        distance,
        parent: current,
        incomingHop:
          hop ?? row.getHop(templateIndex, hopIndex, hopDistance),
        queueOrder,
        active: true,
      }
      const survivingLabels: Label[] = []
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
      if (firstAcceptance) {
        certificates.recordFirstWitness(stateKey, distance, owners)
      }
    }
    const visit = (node: OwnedHyperedgeNode<TOwner>): void => {
      const excluded = row.excludedTemplateIndices[excludedIndex]
      if (
        canSkip &&
        (excluded === undefined || excluded >= node.end) &&
        node.requiredOwners !== undefined &&
        node.maxWitnessDistance <= current.distance
      ) {
        let covered = true
        for (const owner of node.requiredOwners) {
          if (!current.owners.has(owner)) {
            covered = false
            break
          }
        }
        if (covered) {
          const count = node.end - node.start
          nextQueueOrder = advanceOwnedQueueOrder(nextQueueOrder, count)
          yieldedIndex += count
          return
        }
      }
      if (node.left !== undefined && node.right !== undefined) {
        visit(node.left)
        visit(node.right)
      } else if (node.start === excluded) {
        excludedIndex++
      } else {
        relax(node.start)
      }
    }
    if (tree === undefined) {
      for (let index = 0; index < row.templates.length; index++) {
        if (index === row.excludedTemplateIndices[excludedIndex]) {
          excludedIndex++
        } else {
          relax(index)
        }
      }
    } else {
      visit(tree)
    }
  }
}
