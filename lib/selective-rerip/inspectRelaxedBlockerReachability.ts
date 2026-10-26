import type { TinyHyperGraphSolver } from "../core"
import type { HopId, PortId, RegionId } from "../types"
import type {
  RelaxedSearchHop,
  RelaxedSearchState,
} from "./relaxedBlockerSearchTypes"

type BlockerReachability =
  | { kind: "disconnected"; expandedStateCount: number }
  | { kind: "reachable" | "incomplete"; minimumOwnerCount: 0 | 1 }

type ReachabilityInput = {
  start: RelaxedSearchState
  maxExpandedStates: number
}

type RelaxedBlockerReachabilityContext = {
  solver: TinyHyperGraphSolver
  goalPortId: PortId
  getHops: (state: RelaxedSearchState) => readonly RelaxedSearchHop[]
  // Multilayer templates include the incoming port; exits and owners depend
  // only on their destination. The traversal excludes each state's entry.
  getHopTemplates: (state: RelaxedSearchState) => readonly RelaxedSearchHop[]
}

type ReachabilityTraversal = {
  search: RelaxedBlockerReachabilityContext
  ownerFreeQueue: RelaxedSearchState[]
  ownedQueue: RelaxedSearchState[]
  ownerFreeByHopId: Map<HopId, boolean>
  expansionsByRegion: Map<RegionId, 1 | 2>
  totalHopDistance: number
  ownerFreePhase: boolean
}

function enqueueReachabilityHop(
  hop: RelaxedSearchHop,
  traversal: ReachabilityTraversal,
): boolean {
  traversal.totalHopDistance += hop.distance
  if (hop.distance < 0 || !Number.isFinite(traversal.totalHopDistance)) {
    return false
  }
  const hopId = traversal.search.solver.getHopId(
    hop.state.portId,
    hop.state.nextRegionId,
  )
  if (!traversal.ownerFreePhase) {
    if (!traversal.ownerFreeByHopId.has(hopId)) {
      traversal.ownerFreeByHopId.set(hopId, false)
      traversal.ownedQueue.push(hop.state)
    }
    return true
  }
  if (hop.owners.length > 0) {
    if (!traversal.ownerFreeByHopId.has(hopId)) {
      traversal.ownerFreeByHopId.set(hopId, false)
      traversal.ownedQueue.push(hop.state)
    }
  } else if (traversal.ownerFreeByHopId.get(hopId) !== true) {
    traversal.ownerFreeByHopId.set(hopId, true)
    traversal.ownerFreeQueue.push(hop.state)
  }
  return true
}

function expandReachabilityState(
  state: RelaxedSearchState,
  traversal: ReachabilityTraversal,
): boolean {
  const { solver } = traversal.search
  const entryDependent =
    solver.isKnownSingleLayerRegion(state.nextRegionId) ||
    solver.topology.regionSegmentFeasibility !== undefined
  if (!entryDependent) {
    // Two distinct incoming ports cover all multilayer exits. Owner-free
    // states are exhausted first, so omitted exits already have an equal or
    // better owner-free classification. Single-layer crossings depend on entry.
    const count = traversal.expansionsByRegion.get(state.nextRegionId)
    if (count === 2) return true
    traversal.expansionsByRegion.set(
      state.nextRegionId,
      count === undefined ? 1 : 2,
    )
  }
  if (solver.isRegionReservedForDifferentNet(state.nextRegionId)) return true
  if (entryDependent) {
    for (const hop of traversal.search.getHops(state)) {
      if (!enqueueReachabilityHop(hop, traversal)) return false
    }
    return true
  }
  const templates = traversal.search.getHopTemplates(state)
  const first = templates[0]
  if (!first) return true
  // This record stays inside the traversal; only immutable states are queued.
  // Reuse it instead of allocating a directed hop for every region exit.
  const hop: RelaxedSearchHop = { ...first }
  for (const template of templates) {
    if (template.state.portId === state.portId) continue
    hop.state = template.state
    hop.owners = template.owners
    hop.data = template.data
    hop.distance = Math.hypot(
      solver.topology.portX[state.portId]! -
        solver.topology.portX[template.state.portId]!,
      solver.topology.portY[state.portId]! -
        solver.topology.portY[template.state.portId]!,
    )
    if (!enqueueReachabilityHop(hop, traversal)) return false
  }
  return true
}

/**
 * Inspect the current rerip graph before allocating weighted search labels.
 * The caller must validate bounded geometry and keep occupancy fixed throughout
 * the search. Those conditions make omitted multilayer distances safe to sum.
 */
export function inspectRelaxedBlockerReachability(
  input: ReachabilityInput,
  context: RelaxedBlockerReachabilityContext,
): BlockerReachability {
  if (
    input.maxExpandedStates !== Infinity &&
    (!Number.isInteger(input.maxExpandedStates) || input.maxExpandedStates < 0)
  ) {
    throw new Error("maxExpandedLabels must be a non-negative integer")
  }
  const traversal: ReachabilityTraversal = {
    search: context,
    ownerFreeQueue: [input.start],
    ownedQueue: [],
    ownerFreeByHopId: new Map<HopId, boolean>([
      [
        context.solver.getHopId(input.start.portId, input.start.nextRegionId),
        true,
      ],
    ]),
    expansionsByRegion: new Map<RegionId, 1 | 2>(),
    totalHopDistance: 0,
    ownerFreePhase: true,
  }
  let expandedStateCount = 0
  for (let index = 0; index < traversal.ownerFreeQueue.length; index++) {
    const state = traversal.ownerFreeQueue[index]!
    if (state.portId === context.goalPortId) {
      return { kind: "reachable", minimumOwnerCount: 0 }
    }
    if (expandedStateCount >= input.maxExpandedStates) {
      return { kind: "incomplete", minimumOwnerCount: 0 }
    }
    expandedStateCount++
    if (!expandReachabilityState(state, traversal)) {
      return { kind: "incomplete", minimumOwnerCount: 0 }
    }
  }
  traversal.ownerFreePhase = false
  for (let index = 0; index < traversal.ownedQueue.length; index++) {
    const state = traversal.ownedQueue[index]!
    const hopId = context.solver.getHopId(state.portId, state.nextRegionId)
    if (traversal.ownerFreeByHopId.get(hopId) === true) continue
    if (state.portId === context.goalPortId) {
      return { kind: "reachable", minimumOwnerCount: 1 }
    }
    if (expandedStateCount >= input.maxExpandedStates) {
      return { kind: "incomplete", minimumOwnerCount: 1 }
    }
    expandedStateCount++
    if (!expandReachabilityState(state, traversal)) {
      return { kind: "incomplete", minimumOwnerCount: 1 }
    }
  }
  return { kind: "disconnected", expandedStateCount }
}
