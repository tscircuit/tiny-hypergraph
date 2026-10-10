import type {
  DistinctOwnerBlockerSearchFailure,
} from "./find-distinct-owner-blocker-path"
import type {
  OwnedRelaxedHyperedgeRow,
  OwnedRelaxedHyperedgeSearchOptions,
  OwnedRelaxedSearchState,
} from "./owned-relaxed-hyperedge-types"

type ExpandedHyperedge<TOwner, THopData> = {
  sourcePortId: number
  templates: OwnedRelaxedHyperedgeRow<TOwner, THopData>["templates"]
  pendingTemplateIndices: readonly number[] | undefined
}

/**
 * Private reachability precheck for certified, caller-owned native adjacency.
 * Rows sharing hyperedgeId must use the same stable templates and exclude
 * exactly the occurrences whose destination port is their sourcePortId.
 * Each shared template state must be the state returned by getHop for it.
 * Ordinary rows retain their original included-hop traversal.
 *
 * The caller must use the original precheck when finiteCumulativeDistances is
 * false. Returning undefined here does not certify reachability in that case.
 * With the certificate, omitted edge validation cannot abort the original
 * precheck, and native key/cost/input observation must have no callbacks.
 */
export const findDisconnectedOwnedRelaxedHyperedgeSearch = <
  TOwner,
  THopData = unknown,
>(
  options: OwnedRelaxedHyperedgeSearchOptions<TOwner, THopData>,
  maxExpandedStates: number,
): DistinctOwnerBlockerSearchFailure | undefined => {
  if (!options.finiteCumulativeDistances) return undefined

  const queue: OwnedRelaxedSearchState[] = [options.start]
  const seenStateKeys = new Set([options.getStateKey(options.start)])
  const expandedHyperedges = new Map<
    object,
    ExpandedHyperedge<TOwner, THopData>
  >()
  let expandedStateCount = 0

  const enqueueUnseenState = (state: OwnedRelaxedSearchState): void => {
    const stateKey = options.getStateKey(state)
    if (seenStateKeys.has(stateKey)) return
    seenStateKeys.add(stateKey)
    queue.push(state)
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const state = queue[queueIndex]!
    if (options.isGoal(state)) return undefined
    // Match the original directed-state queue and goal-before-limit order.
    if (expandedStateCount >= maxExpandedStates) return undefined
    expandedStateCount++

    // Register every original expanded key's first row representative, even
    // when its shared hyperedge has no new destinations. Weighted search must
    // retain that representative if a later state has an aliased native key.
    const row = options.getRow(state)
    if (row.hyperedgeId === undefined) {
      let excludedIndex = 0
      let yieldedHopIndex = 0
      for (let index = 0; index < row.templates.length; index++) {
        if (index === row.excludedTemplateIndices[excludedIndex]) {
          excludedIndex++
          continue
        }
        const hop = row.getHop(index, yieldedHopIndex++)
        enqueueUnseenState(hop.state)
      }
      continue
    }

    const expandedHyperedge = expandedHyperedges.get(row.hyperedgeId)
    if (expandedHyperedge === undefined) {
      expandedHyperedges.set(row.hyperedgeId, {
        sourcePortId: row.sourcePortId,
        templates: row.templates,
        pendingTemplateIndices: row.excludedTemplateIndices,
      })
      let excludedIndex = 0
      for (let index = 0; index < row.templates.length; index++) {
        if (index === row.excludedTemplateIndices[excludedIndex]) {
          excludedIndex++
          continue
        }
        enqueueUnseenState(row.templates[index]!.state)
      }
      continue
    }

    if (
      expandedHyperedge.pendingTemplateIndices !== undefined &&
      row.sourcePortId !== expandedHyperedge.sourcePortId
    ) {
      // Every other template key entered seen on the first region scan. Only
      // the first source's omitted exits can become newly reachable now.
      for (const index of expandedHyperedge.pendingTemplateIndices) {
        enqueueUnseenState(expandedHyperedge.templates[index]!.state)
      }
      expandedHyperedge.pendingTemplateIndices = undefined
    }
  }

  return {
    found: false,
    reason: "no_path",
    expandedLabelCount: expandedStateCount,
  }
}
