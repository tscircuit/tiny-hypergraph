import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type NodeId = number
type OwnerId = number
type Hop = { state: NodeId; distance: number; owners: OwnerId[] }

test("invalid weighted hops close their iterator before reading further entries", (): void => {
  for (const invalidState of [0, 1]) {
    for (const checkReachability of [false, true]) {
      const closed: NodeId[] = []
      const graph: Hop[][] = [
        [{ state: 1, distance: invalidState === 0 ? -1 : 1, owners: [0] }],
        [{ state: 2, distance: invalidState === 1 ? Infinity : 1, owners: [] }],
        [],
      ]
      expect((): unknown => findDistinctOwnerBlockerPath({
        start: 0,
        getStateKey: (state: NodeId): NodeId => state,
        isGoal: (state: NodeId): boolean => state === 2,
        *getHops(state: NodeId): Generator<Hop> {
          try {
            for (const hop of graph[state]!) yield hop
            if (state === invalidState) throw new Error("Read after invalid hop")
          } finally {
            closed.push(state)
          }
        },
        checkReachability,
      })).toThrow("Distinct-owner blocker hops require finite distances >= 0")
      const pass = Array.from({ length: invalidState + 1 }, (_, index): NodeId => index)
      expect(closed).toEqual(checkReachability ? [...pass, ...pass] : pass)
    }
  }
})
