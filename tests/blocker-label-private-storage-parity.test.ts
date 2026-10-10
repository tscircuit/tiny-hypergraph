import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"
import { legacyFindDistinctOwnerBlockerPath } from "./fixtures/legacy-distinct-owner-blocker-path"

type Owner = string | number | symbol | { id: number }
type Edge = {
  state: number
  distance: number
  owners?: Owner[]
}
type Graph = {
  edges: Edge[][]
  goal: number
  maxExpandedLabels?: number
  checkReachability?: boolean
  keyModulo?: number
}
type SearchReport = { result: unknown; trace: string[] }

const ownerValues: Owner[] = [
  "owner-a",
  "owner-b",
  Number.NaN,
  { id: 1 },
  { id: 1 },
  Symbol("owner"),
  0,
]
const ownerIds = new Map<Owner, number>(
  ownerValues.map((owner, index): [Owner, number] => [owner, index]),
)

function replayGraph(
  search: typeof findDistinctOwnerBlockerPath,
  graph: Graph,
): SearchReport {
  const trace: string[] = []
  let hopId = 0
  const hopsByState = graph.edges.map(
    (edges): Array<DistinctOwnerBlockerHop<number, Owner, number>> =>
      edges.map((edge): DistinctOwnerBlockerHop<number, Owner, number> => {
        const id = hopId++
        return {
          state: edge.state,
          data: id,
          get distance(): number {
            trace.push(`distance:${id}`)
            return edge.distance
          },
          get owners(): Owner[] | undefined {
            trace.push(`owners:${id}`)
            return edge.owners
          },
        }
      }),
  )
  try {
    const result = search<number, number, Owner, number>({
      start: 0,
      getStateKey(state: number): number {
        trace.push(`key:${state}`)
        return graph.keyModulo === undefined ? state : state % graph.keyModulo
      },
      isGoal(state: number): boolean {
        trace.push(`goal:${state}`)
        return state === graph.goal
      },
      get getHops(): (
        state: number,
      ) => Iterable<DistinctOwnerBlockerHop<number, Owner, number>> {
        trace.push("lookup:getHops")
        return (
          state: number,
        ): Iterable<DistinctOwnerBlockerHop<number, Owner, number>> => {
          trace.push(`hops:${state}`)
          return {
            *[Symbol.iterator](): Generator<
              DistinctOwnerBlockerHop<number, Owner, number>
            > {
              for (const hop of hopsByState[state]!) {
                trace.push(`yield:${hop.data}`)
                yield hop
              }
            },
          }
        }
      },
      maxExpandedLabels: graph.maxExpandedLabels,
      checkReachability: graph.checkReachability,
    })
    if (!result.found) return { result, trace }
    return {
      result: {
        found: result.found,
        states: result.states,
        hops: result.hops.map((hop): number => hop.data!),
        owners: [...result.owners].map((owner): number => ownerIds.get(owner)!),
        distance: result.distance,
        expandedLabelCount: result.expandedLabelCount,
      },
      trace,
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { result: { error: error.message, name: error.name }, trace }
  }
}

function randomValue(state: { value: number }): number {
  let value = state.value
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state.value = value >>> 0
  return state.value
}

test("private label storage preserves legacy search order", (): void => {
  const graphs: Graph[] = [
    { edges: [[]], goal: 0, maxExpandedLabels: 0 },
    { edges: [[], []], goal: 1 },
    {
      edges: [
        [
          { state: 1, distance: 9 },
          { state: 1, distance: 1 },
          { state: 2, distance: 1, owners: [ownerValues[0]!] },
          { state: 2, distance: 1, owners: [ownerValues[1]!] },
          { state: 3, distance: 1 },
        ],
        [{ state: 3, distance: 1 }],
        [{ state: 3, distance: 0, owners: [ownerValues[1]!] }],
        [],
      ],
      goal: 3,
    },
    {
      edges: [
        [
          { state: 1, distance: 0, owners: ownerValues },
          { state: 1, distance: -0, owners: [...ownerValues].reverse() },
        ],
        [{ state: 2, distance: 1, owners: [ownerValues[2]!, ownerValues[2]!] }],
        [],
      ],
      goal: 2,
    },
    {
      edges: [
        [{ state: 1, distance: 1e308 }],
        [{ state: 2, distance: 1e308 }],
        [],
      ],
      goal: 2,
    },
  ]
  for (const distance of [Number.NaN, Infinity, -Infinity, -1]) {
    graphs.push({ edges: [[{ state: 1, distance }], []], goal: 1 })
  }
  for (const maxExpandedLabels of [-1, 0.5, Number.NaN, -Infinity]) {
    graphs.push({ edges: [[], []], goal: 1, maxExpandedLabels })
  }
  const random = { value: 0x56ad849 }
  for (let caseIndex = 0; caseIndex < 240; caseIndex++) {
    const stateCount = 6 + (randomValue(random) % 11)
    const edges: Edge[][] = []
    for (let state = 0; state < stateCount; state++) {
      const stateEdges: Edge[] = []
      const edgeCount = randomValue(random) % 8
      for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
        const owners: Owner[] = []
        const ownerCount = randomValue(random) % 4
        for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex++) {
          owners.push(ownerValues[randomValue(random) % ownerValues.length]!)
        }
        stateEdges.push({
          state: randomValue(random) % stateCount,
          distance: randomValue(random) % 5,
          owners: ownerCount === 0 && caseIndex % 2 === 0 ? undefined : owners,
        })
      }
      edges.push(stateEdges)
    }
    graphs.push({
      edges,
      goal: randomValue(random) % stateCount,
      maxExpandedLabels: [0, 1, 8, 64, Infinity][caseIndex % 5],
      keyModulo: caseIndex % 7 === 0 ? stateCount - 1 : undefined,
    })
  }
  let comparisons = 0
  for (const graph of graphs) {
    for (const checkReachability of [false, true]) {
      const input = { ...graph, checkReachability }
      const original = replayGraph(legacyFindDistinctOwnerBlockerPath, input)
      const candidate = replayGraph(findDistinctOwnerBlockerPath, input)
      expect(candidate).toEqual(original)
      comparisons++
    }
  }
  expect(comparisons).toBe(506)
})
