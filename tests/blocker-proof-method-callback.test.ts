import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type NodeId = number
type OwnerId = number
type Hop = { state: NodeId; distance: number; owners: OwnerId[] }
type HopVisitor = (hop: Hop) => boolean

test("reachability providers keep the same method receiver as weighted hop callbacks", (): void => {
  const graph: Hop[][] = [
    [{ state: 1, distance: 1, owners: [0] }],
    [{ state: 2, distance: 1, owners: [] }],
    [],
  ]
  const options = {
    graph,
    start: 0,
    getStateKey: (state: NodeId): NodeId => state,
    isGoal: (state: NodeId): boolean => state === 2,
    getHops(state: NodeId): Hop[] {
      return this.graph[state]!
    },
    checkOwnerFreeReachability: true,
  }
  const separateProvider = {
    ...options,
    forEachReachabilityHop(state: NodeId, visit: HopVisitor): void {
      for (const hop of this.graph[state]!) {
        if (!visit({ ...hop })) return
      }
    },
  }
  for (const fixture of [options, separateProvider]) {
    for (const checkReachability of [false, true]) {
      const result = findDistinctOwnerBlockerPath({
        ...fixture,
        checkReachability,
      })
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.distance).toBe(2)
        expect([...result.owners]).toEqual([0])
      }
    }
  }
})
