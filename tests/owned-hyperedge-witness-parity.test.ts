import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPathWithOwnedHyperedges,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"
import type {
  OwnedRelaxedHyperedgeRow,
  OwnedRelaxedSearchState,
} from "lib/owned-relaxed-hyperedge-types"
import { legacyFindDistinctOwnerBlockerPath as legacySearch } from "./fixtures/legacy-distinct-owner-blocker-path"

type State = OwnedRelaxedSearchState
type Hop = DistinctOwnerBlockerHop<State, number, { occurrence: number }>
type Row = OwnedRelaxedHyperedgeRow<number, { occurrence: number }>

const getKey = (state: State): number => state.portId * 3 + state.nextRegionId

const makeRows = (
  templates: Hop[][],
  scalar: boolean,
  keyOf: (state: State) => number = getKey,
) => {
  const cached = new Map<number, Row>()
  let materialized = 0
  let visitedEdges = 0
  let legacyEdges = 0
  const getRow = (state: State): Row => {
    const key = keyOf(state)
    const existing = cached.get(key)
    if (existing !== undefined) return existing
    const raw = templates[state.nextRegionId]!
    const exclusions: number[] = []
    const included: Hop[] = []
    const eagerByRaw = new Map<number, Hop>()
    const distance = (index: number): number =>
      Math.hypot(state.portId - raw[index]!.state.portId, 0)
    for (let index = 0; index < raw.length; index++) {
      if (raw[index]!.state.portId === state.portId) {
        exclusions.push(index)
      } else {
        const hop = { ...raw[index]!, distance: distance(index) }
        included.push(hop)
        eagerByRaw.set(index, hop)
      }
    }
    const row: Row = {
      hyperedgeId: raw,
      regionId: state.nextRegionId,
      sourcePortId: state.portId,
      templates: raw,
      excludedTemplateIndices: exclusions,
      eagerHops: included,
      getHop: (index, _yielded, value) => {
        materialized++
        return scalar
          ? { ...raw[index]!, distance: value ?? distance(index) }
          : eagerByRaw.get(index)!
      },
    }
    if (scalar) {
      row.getHopDistance = (index) => {
        visitedEdges++
        return distance(index)
      }
    }
    cached.set(key, row)
    return row
  }
  return {
    getRow,
    getHops: (state: State): readonly Hop[] => {
      const hops = getRow(state).eagerHops!
      legacyEdges += hops.length
      return hops
    },
    counts: () => ({ materialized, visitedEdges, legacyEdges }),
  }
}

const compare = (
  templates: Hop[][],
  goalPortId: number,
  budget: number,
  scalar: boolean,
  keyOf: (state: State) => number = getKey,
): {
  materialized: number
  visitedEdges: number
  legacyEdges: number
} => {
  const rows = makeRows(templates, scalar, keyOf)
  const oldGoals: number[] = []
  const newGoals: number[] = []
  const options = {
    start: { portId: 0, nextRegionId: 0 },
    getStateKey: keyOf,
    maxExpandedLabels: budget,
  }
  const old = legacySearch({
    ...options,
    isGoal: (state) => {
      oldGoals.push(getKey(state))
      return state.portId === goalPortId
    },
    getHops: rows.getHops,
  })
  const current = findDistinctOwnerBlockerPathWithOwnedHyperedges({
    ...options,
    isGoal: (state) => {
      newGoals.push(getKey(state))
      return state.portId === goalPortId
    },
    getRow: rows.getRow,
    finiteCumulativeDistances: true,
  })
  expect(current).toEqual(old)
  expect(newGoals).toEqual(oldGoals)
  if (old.found && current.found) {
    expect([...current.owners]).toEqual([...old.owners])
    for (let index = 0; index < old.hops.length; index++) {
      expect(current.hops[index]!.state).toBe(old.hops[index]!.state)
      expect(current.hops[index]!.data).toBe(old.hops[index]!.data)
      if (!scalar) expect(current.hops[index]).toBe(old.hops[index])
    }
  }
  return rows.counts()
}

test("regional witnesses retain legacy paths and ordered subtree rejection", () => {
  let seed = 82931
  const random = (limit: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % limit
  }
  for (let sample = 0; sample < 192; sample++) {
    const portCount = 3 + random(5)
    const templates: Hop[][] = Array.from({ length: 3 }, () => [])
    let occurrence = 0
    for (let region = 0; region < 3; region++) {
      for (let port = 0; port < portCount; port++) {
        if (random(5) === 0) continue
        const owners: number[] = []
        if (random(3) === 0) owners.push(random(3))
        if (random(5) === 0) owners.push(random(3))
        const hop: Hop = {
          state: { portId: port, nextRegionId: random(3) },
          distance: 0,
          owners,
          data: { occurrence: occurrence++ },
        }
        templates[region]!.push(hop)
        if (random(4) === 0) templates[region]!.push(hop)
      }
    }
    for (const scalar of [false, true]) {
      compare(templates, sample % (portCount + 1), sample % 31, scalar)
    }
  }

  const dense: Hop[][] = Array.from({ length: 3 }, (_, region) =>
    Array.from({ length: 24 }, (_, port) => ({
      state: { portId: port, nextRegionId: (region + 1) % 3 },
      distance: 0,
      owners: port % 5 === 0 ? [port % 3] : [],
      data: { occurrence: region * 24 + port },
    })),
  )
  const inactiveWitness: Hop[][] = [
    [
      {
        state: { portId: 1, nextRegionId: 1 },
        distance: 0,
        owners: [],
        data: { occurrence: 0 },
      },
      {
        state: { portId: 5, nextRegionId: 0 },
        distance: 0,
        owners: [1],
        data: { occurrence: 1 },
      },
      {
        state: { portId: 0, nextRegionId: 0 },
        distance: 0,
        owners: [],
        data: { occurrence: 2 },
      },
    ],
    [
      {
        state: { portId: 5, nextRegionId: 0 },
        distance: 0,
        owners: [],
        data: { occurrence: 3 },
      },
    ],
    [],
  ]
  for (const scalar of [false, true]) {
    compare(inactiveWitness, 99, 4096, scalar)
    compare(
      dense,
      99,
      4096,
      scalar,
      (state) => (state.portId % 3) * 3 + state.nextRegionId,
    )
    compare(dense, 99, 4096, scalar, (state) => -getKey(state) - 1)
  }
  const counts = compare(dense, 99, 4096, true)
  expect(counts.visitedEdges).toBeLessThan(counts.legacyEdges)
  expect(counts.materialized).toBeLessThan(counts.visitedEdges)

  const invalid: Hop[][] = [
    [
      {
        state: { portId: 1, nextRegionId: 0 },
        distance: Number.NaN,
        owners: [],
        data: { occurrence: 0 },
      },
    ],
  ]
  const row: Row = {
    regionId: 0,
    sourcePortId: 0,
    templates: invalid[0]!,
    excludedTemplateIndices: [],
    eagerHops: invalid[0]!,
    getHop: (index) => invalid[0]![index]!,
  }
  for (const checkReachability of [false, true]) {
    const common = {
      start: { portId: 0, nextRegionId: 0 },
      getStateKey: getKey,
      isGoal: () => false,
      checkReachability,
      maxExpandedLabels: 4,
    }
    expect(() =>
      legacySearch({
        ...common,
        getHops: () => invalid[0]!,
      }),
    ).toThrow("finite distances >= 0")
    expect(() =>
      findDistinctOwnerBlockerPathWithOwnedHyperedges({
        ...common,
        getRow: () => row,
        finiteCumulativeDistances: false,
      }),
    ).toThrow("finite distances >= 0")
  }
})
