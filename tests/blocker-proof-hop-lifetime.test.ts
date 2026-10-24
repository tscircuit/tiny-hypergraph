import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type NodeId = number
type OwnerId = number
type Hop = { state: NodeId; distance: number; owners: OwnerId[] }
type HopVisitor = (hop: Hop) => boolean

test("proof traversal upgrades owned boundaries and reconstructs only weighted hops", (): void => {
  const graph: Hop[][] = [
    [
      { state: 1, distance: 1, owners: [0] },
      { state: 2, distance: 10, owners: [] },
    ],
    [{ state: 3, distance: 1, owners: [] }],
    [{ state: 1, distance: 1, owners: [] }],
    [],
  ]
  const proofVisits: NodeId[] = []
  const weightedVisits: NodeId[] = []
  const options = {
    start: 0,
    getStateKey: (state: NodeId): NodeId => state,
    isGoal: (state: NodeId): boolean => state === 3,
    getHops: (state: NodeId): Hop[] => {
      weightedVisits.push(state)
      return graph[state]!
    },
    forEachReachabilityHop: (state: NodeId, visit: HopVisitor): void => {
      proofVisits.push(state)
      for (const hop of graph[state]!) {
        if (!visit({ ...hop, owners: [...hop.owners] })) return
      }
    },
    checkReachability: true,
    checkOwnerFreeReachability: true,
    getRemainingDistance: (): number => 0,
  }
  const result = findDistinctOwnerBlockerPath(options)
  expect(result.found).toBe(true)
  if (result.found) {
    expect(result.owners.size).toBe(0)
    expect(result.distance).toBe(12)
    for (const [index, hop] of result.hops.entries()) {
      expect(graph[result.states[index]!]!.includes(hop as Hop)).toBe(true)
    }
  }
  expect(proofVisits).toEqual([0, 2, 1])
  expect(weightedVisits).toEqual([0, 2, 1])
  graph[1]![0]!.owners = [1]
  for (const maxExpandedLabels of [0, 1, 2, 3, 4]) {
    proofVisits.length = 0
    weightedVisits.length = 0
    const disconnected = findDistinctOwnerBlockerPath({
      ...options,
      isGoal: (state: NodeId): boolean => state === 4,
      maxExpandedLabels,
    })
    expect(new Set(proofVisits).size).toBe(proofVisits.length)
    if (maxExpandedLabels < 4) {
      expect(disconnected).toEqual({
        found: false,
        reason: "expansion_limit",
        expandedLabelCount: maxExpandedLabels,
      })
    } else {
      expect(disconnected).toEqual({
        found: false,
        reason: "no_path",
        expandedLabelCount: 4,
      })
      expect(proofVisits).toEqual([0, 2, 1, 3])
      expect(weightedVisits).toEqual([])
    }
  }
})
