import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchOptions,
} from "./find-distinct-owner-blocker-path"

export type BlockerReachability =
  | { kind: "disconnected"; expandedStateCount: number }
  | { kind: "reachable" | "incomplete"; minimumOwnerCount: 0 | 1 }

type ReachabilityContext<TState, TStateKey, TOwner, THopData> = {
  options: DistinctOwnerBlockerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >
  ownerFreeQueue: TState[]
  ownedQueue: TState[]
  ownerFreeByState: Map<TStateKey, boolean>
  totalHopDistance: number
  ownerFreePhase: boolean
  validHopDistances: boolean
}

type ReachabilityHopTraversal<TState, TStateKey, TOwner, THopData> = {
  options: DistinctOwnerBlockerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >
  visitHop: (hop: DistinctOwnerBlockerHop<TState, TOwner, THopData>) => boolean
}

function visitReachabilityHop<TState, TStateKey, TOwner, THopData>(
  hop: DistinctOwnerBlockerHop<TState, TOwner, THopData>,
  context: ReachabilityContext<TState, TStateKey, TOwner, THopData>,
): boolean {
  context.totalHopDistance += hop.distance
  if (hop.distance < 0 || !Number.isFinite(context.totalHopDistance)) {
    context.validHopDistances = false
    return false
  }
  if (!context.ownerFreePhase) {
    const stateKey = context.options.getStateKey(hop.state)
    if (!context.ownerFreeByState.has(stateKey)) {
      context.ownerFreeByState.set(stateKey, false)
      context.ownedQueue.push(hop.state)
    }
    return true
  }
  let hasOwners = false
  for (const _owner of hop.owners ?? []) {
    hasOwners = true
    break
  }
  const stateKey = context.options.getStateKey(hop.state)
  if (hasOwners) {
    if (!context.ownerFreeByState.has(stateKey)) {
      context.ownerFreeByState.set(stateKey, false)
      context.ownedQueue.push(hop.state)
    }
  } else if (context.ownerFreeByState.get(stateKey) !== true) {
    context.ownerFreeByState.set(stateKey, true)
    context.ownerFreeQueue.push(hop.state)
  }
  return true
}

function visitStateHops<TState, TStateKey, TOwner, THopData>(
  state: TState,
  traversal: ReachabilityHopTraversal<TState, TStateKey, TOwner, THopData>,
): void {
  const { options, visitHop } = traversal
  if (options.forEachReachabilityHop) {
    options.forEachReachabilityHop.call(options, state, visitHop)
    return
  }
  for (const hop of options.getHops(state)) {
    if (!visitHop(hop)) break
  }
}

/** Classify reachability without retaining borrowed hops or enumerating owner sets. */
export function inspectBlockerReachability<TState, TStateKey, TOwner, THopData>(
  options: DistinctOwnerBlockerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >,
  maxExpandedStates: number,
): BlockerReachability {
  const context: ReachabilityContext<TState, TStateKey, TOwner, THopData> = {
    options,
    ownerFreeQueue: [options.start],
    ownedQueue: [],
    // Upgrade boundary states reached later without an owner; skip their stale
    // owned-queue entries instead of suppressing the owner-free path.
    ownerFreeByState: new Map<TStateKey, boolean>([
      [options.getStateKey(options.start), true],
    ]),
    totalHopDistance: 0,
    ownerFreePhase: true,
    validHopDistances: true,
  }
  const traversal: ReachabilityHopTraversal<
    TState,
    TStateKey,
    TOwner,
    THopData
  > = {
    options,
    // One callback per search; visiting a state or hop allocates no wrapper.
    visitHop: (hop): boolean => visitReachabilityHop(hop, context),
  }
  let expandedStateCount = 0
  for (let index = 0; index < context.ownerFreeQueue.length; index++) {
    const state = context.ownerFreeQueue[index]!
    if (options.isGoal(state)) {
      return { kind: "reachable", minimumOwnerCount: 0 }
    }
    if (expandedStateCount >= maxExpandedStates) {
      return { kind: "incomplete", minimumOwnerCount: 0 }
    }
    expandedStateCount++
    if (options.shouldExpandReachabilityState?.(state) === false) continue
    visitStateHops(state, traversal)
    if (!context.validHopDistances) {
      return { kind: "incomplete", minimumOwnerCount: 0 }
    }
  }

  if (!options.checkReachability) {
    return { kind: "incomplete", minimumOwnerCount: 1 }
  }
  context.ownerFreePhase = false
  for (let index = 0; index < context.ownedQueue.length; index++) {
    const state = context.ownedQueue[index]!
    if (context.ownerFreeByState.get(options.getStateKey(state)) === true)
      continue
    if (options.isGoal(state)) {
      return { kind: "reachable", minimumOwnerCount: 1 }
    }
    if (expandedStateCount >= maxExpandedStates) {
      return { kind: "incomplete", minimumOwnerCount: 1 }
    }
    expandedStateCount++
    if (options.shouldExpandReachabilityState?.(state) === false) continue
    visitStateHops(state, traversal)
    if (!context.validHopDistances) {
      return { kind: "incomplete", minimumOwnerCount: 1 }
    }
  }
  return { kind: "disconnected", expandedStateCount }
}
