import { expect, test } from "bun:test"
import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchFailure,
} from "../lib/find-distinct-owner-blocker-path"
import { findDisconnectedOwnedRelaxedHyperedgeSearch } from "../lib/owned-relaxed-hyperedge-reachability"
import type {
  OwnedRelaxedHyperedgeRow,
  OwnedRelaxedHyperedgeSearchOptions,
  OwnedRelaxedSearchState,
} from "../lib/owned-relaxed-hyperedge-types"

type Hop = DistinctOwnerBlockerHop<OwnedRelaxedSearchState, number>
type Row = OwnedRelaxedHyperedgeRow<number>
type Options = OwnedRelaxedHyperedgeSearchOptions<number>
type Fixture = {
  templatesByRegion: ReadonlyMap<number, readonly Hop[]>
  ordinaryRegions: ReadonlySet<number>
  duplicateKey: boolean
  goalPortId: number
  finiteCumulativeDistances: boolean
  forcedDistance?: number
}

const stateName = (state: OwnedRelaxedSearchState): string =>
  `${state.portId}:${state.nextRegionId}`

// Original 474f precheck: materialize a complete native row before traversing
// it, add every distance before deduplication, and test goal before the budget.
const findDisconnectedOriginal = (
  options: Options,
  maxExpandedStates: number,
): DistinctOwnerBlockerSearchFailure | undefined => {
  const queue = [options.start]
  const seenStateKeys = new Set([options.getStateKey(options.start)])
  let expandedStateCount = 0
  let totalHopDistance = 0

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const state = queue[queueIndex]!
    if (options.isGoal(state)) return undefined
    if (expandedStateCount >= maxExpandedStates) return undefined
    expandedStateCount++
    const row = options.getRow(state)
    const hops: Hop[] = []
    let excludedIndex = 0
    for (let index = 0; index < row.templates.length; index++) {
      if (index === row.excludedTemplateIndices[excludedIndex]) {
        excludedIndex++
        continue
      }
      hops.push(row.getHop(index, hops.length))
    }
    for (const hop of hops) {
      totalHopDistance += hop.distance
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

const makeSearch = (fixture: Fixture) => {
  const rowRequests: string[] = []
  const goalPops: string[] = []
  const ordinaryHopCalls: string[] = []
  const rowsByKey = new Map<number, Row>()
  const emptyTemplates: readonly Hop[] = []
  const getStateKey = (state: OwnedRelaxedSearchState): number => {
    if (
      fixture.duplicateKey &&
      state.nextRegionId === 2 &&
      (state.portId === 1 || state.portId === 2)
    ) {
      return 7
    }
    return state.portId * 10 + state.nextRegionId
  }
  const getRow = (state: OwnedRelaxedSearchState): Row => {
    rowRequests.push(stateName(state))
    const key = getStateKey(state)
    const cached = rowsByKey.get(key)
    if (cached !== undefined) return cached
    const templates =
      fixture.templatesByRegion.get(state.nextRegionId) ?? emptyTemplates
    const ordinary = fixture.ordinaryRegions.has(state.nextRegionId)
    const excludedTemplateIndices: number[] = []
    for (let index = 0; index < templates.length; index++) {
      if (templates[index]!.state.portId === state.portId) {
        excludedTemplateIndices.push(index)
      }
    }
    const capturedHops = new Map<number, Hop>()
    const row: Row = {
      hyperedgeId: ordinary ? undefined : templates,
      regionId: state.nextRegionId,
      sourcePortId: state.portId,
      templates,
      excludedTemplateIndices,
      getHop(index, yieldedIndex): Hop {
        if (ordinary) {
          ordinaryHopCalls.push(
            `${stateName(state)}:${index}:${yieldedIndex}`,
          )
        }
        const captured = capturedHops.get(index)
        if (captured !== undefined) return captured
        const template = templates[index]!
        const hop: Hop = {
          state: template.state,
          distance:
            fixture.forcedDistance ??
            Math.abs(state.portId - template.state.portId),
          owners: ordinary ? [state.portId] : template.owners,
        }
        capturedHops.set(index, hop)
        return hop
      },
    }
    rowsByKey.set(key, row)
    return row
  }
  const options: Options = {
    start: { portId: 0, nextRegionId: 0 },
    getStateKey,
    isGoal(state): boolean {
      goalPops.push(stateName(state))
      return state.portId === fixture.goalPortId
    },
    getRow,
    finiteCumulativeDistances: fixture.finiteCumulativeDistances,
  }
  const cacheSnapshot = () =>
    [...rowsByKey].map(([key, row]) => ({
      key,
      sourcePortId: row.sourcePortId,
      regionId: row.regionId,
      excluded: row.excludedTemplateIndices,
      states: row.templates.map((hop) => stateName(hop.state)),
    }))
  return {
    options,
    rowRequests,
    goalPops,
    ordinaryHopCalls,
    cacheSnapshot,
  }
}

test("owned reachability retains original directed-state results", () => {
  const hop = (portId: number, nextRegionId: number): Hop => ({
    state: { portId, nextRegionId },
    owners: [],
    distance: 1,
  })
  const a = hop(0, 1)
  const b = hop(1, 2)
  const c = hop(2, 2)
  const d = hop(3, 1)
  const templatesByRegion = new Map<number, readonly Hop[]>([
    [0, [a, b, c]],
    [1, [hop(0, 0), d]],
    [2, [hop(1, 0), hop(2, 0)]],
  ])
  const duplicateTemplates = new Map(templatesByRegion)
  duplicateTemplates.set(0, [a, b, b, c, a])

  for (const templates of [templatesByRegion, duplicateTemplates]) {
    for (const ordinary of [false, true]) {
      for (const duplicateKey of [false, true]) {
        for (const goalPortId of [0, 3, 99]) {
          for (const budget of [0, 1, 2, 5, 6, 7, 8, Infinity]) {
            const fixture: Fixture = {
              templatesByRegion: templates,
              ordinaryRegions: new Set(ordinary ? [2] : []),
              duplicateKey,
              goalPortId,
              finiteCumulativeDistances: true,
            }
            const original = makeSearch(fixture)
            const optimized = makeSearch(fixture)
            const originalResult = findDisconnectedOriginal(
              original.options,
              budget,
            )
            const optimizedResult =
              findDisconnectedOwnedRelaxedHyperedgeSearch(
                optimized.options,
                budget,
              )
            expect(optimizedResult).toEqual(originalResult)
            expect(optimized.goalPops).toEqual(original.goalPops)
            expect(optimized.rowRequests).toEqual(original.rowRequests)
            expect(optimized.ordinaryHopCalls).toEqual(
              original.ordinaryHopCalls,
            )
            expect(optimized.cacheSnapshot()).toEqual(
              original.cacheSnapshot(),
            )
          }
        }
      }
    }
  }

  // Re-entering region 0 through port 2 must reintroduce port 0's other
  // directed state. The goal is reachable only through that omitted exit.
  const connected = makeSearch({
    templatesByRegion,
    ordinaryRegions: new Set<number>(),
    duplicateKey: false,
    goalPortId: 3,
    finiteCumulativeDistances: true,
  })
  expect(
    findDisconnectedOwnedRelaxedHyperedgeSearch(connected.options, 6),
  ).toBeUndefined()
  expect(connected.goalPops).toEqual([
    "0:0",
    "1:2",
    "2:2",
    "2:0",
    "1:0",
    "0:1",
    "3:1",
  ])
  expect(connected.rowRequests).toHaveLength(6)

  const disconnectedFixture: Fixture = {
    templatesByRegion,
    ordinaryRegions: new Set<number>(),
    duplicateKey: false,
    goalPortId: 99,
    finiteCumulativeDistances: true,
  }
  const disconnected = makeSearch(disconnectedFixture)
  expect(
    findDisconnectedOwnedRelaxedHyperedgeSearch(disconnected.options, 7),
  ).toEqual({ found: false, reason: "no_path", expandedLabelCount: 7 })

  // A later weighted caller may present port 2 for the key whose original
  // BFS representative was port 1. It must keep port 1's cached adjacency.
  const aliasedFixture: Fixture = {
    ...disconnectedFixture,
    duplicateKey: true,
  }
  const originalAlias = makeSearch(aliasedFixture)
  const optimizedAlias = makeSearch(aliasedFixture)
  expect(
    findDisconnectedOwnedRelaxedHyperedgeSearch(
      optimizedAlias.options,
      Infinity,
    ),
  ).toEqual(findDisconnectedOriginal(originalAlias.options, Infinity))
  const weightedState = { portId: 2, nextRegionId: 2 }
  const originalRow = originalAlias.options.getRow(weightedState)
  const optimizedRow = optimizedAlias.options.getRow(weightedState)
  expect(optimizedRow.sourcePortId).toBe(1)
  expect(optimizedRow.sourcePortId).toBe(originalRow.sourcePortId)
  expect(optimizedRow.excludedTemplateIndices).toEqual([0])
  const originalHop = originalRow.getHop(1, 0)
  const optimizedHop = optimizedRow.getHop(1, 0)
  expect(optimizedHop).toEqual(originalHop)
  expect(optimizedHop.state).toBe(originalHop.state)
  expect(optimizedRow.getHop(1, 0)).toBe(optimizedHop)

  // Without the arithmetic certificate, the caller runs the original
  // cumulative-distance precheck. The private helper must touch no callbacks.
  for (const distance of [NaN, Infinity, -1, Number.MAX_VALUE]) {
    const unsafeFixture: Fixture = {
      ...disconnectedFixture,
      finiteCumulativeDistances: false,
      forcedDistance: distance,
    }
    const original = makeSearch(unsafeFixture)
    const fallback = makeSearch(unsafeFixture)
    expect(
      findDisconnectedOwnedRelaxedHyperedgeSearch(fallback.options, 7),
    ).toBeUndefined()
    expect(fallback.goalPops).toEqual([])
    expect(fallback.rowRequests).toEqual([])
    expect(findDisconnectedOriginal(fallback.options, 7)).toEqual(
      findDisconnectedOriginal(original.options, 7),
    )
    expect(fallback.goalPops).toEqual(original.goalPops)
    expect(fallback.rowRequests).toEqual(original.rowRequests)
  }
})
