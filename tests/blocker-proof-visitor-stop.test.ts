import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

type NodeId = number
type OwnerId = number
type Hop = { state: NodeId; distance: number; owners: OwnerId[] }
type HopVisitor = (hop: Hop) => boolean

test("proof visitors stop on invalid distances and propagate callback failures", (): void => {
  for (const invalidState of [0, 1]) {
    for (const customProvider of [false, true]) {
      const closed: NodeId[] = []
      const visited: NodeId[] = []
      const graph: Hop[][] = [
        [{ state: 1, distance: invalidState === 0 ? -1 : 1, owners: [0] }],
        [{ state: 2, distance: invalidState === 1 ? Infinity : 1, owners: [] }],
        [],
      ]
      const options = {
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
        checkReachability: true,
        checkOwnerFreeReachability: true,
        ...(customProvider ? {
          forEachReachabilityHop(state: NodeId, visit: HopVisitor): void {
            visited.push(state)
            for (const hop of graph[state]!) {
              if (!visit({ ...hop })) return
            }
            if (state === invalidState) throw new Error("Ignored stop request")
          },
        } : {}),
      }
      expect(() => findDistinctOwnerBlockerPath(options)).toThrow(
        "Distinct-owner blocker hops require finite distances >= 0",
      )
      expect(closed).toEqual(customProvider
        ? Array.from({ length: invalidState + 1 }, (_, index): NodeId => index)
        : [
          ...Array.from({ length: invalidState + 1 }, (_, index): NodeId => index),
          ...Array.from({ length: invalidState + 1 }, (_, index): NodeId => index),
        ])
      expect(visited).toEqual(customProvider
        ? Array.from({ length: invalidState + 1 }, (_, index): NodeId => index)
        : [])
    }
  }

  const callbackError = new Error("State key failed")
  let returnedFromVisit = false
  expect(() => findDistinctOwnerBlockerPath({
    start: 0,
    getStateKey: (state: NodeId): NodeId => {
      if (state === 1) throw callbackError
      return state
    },
    isGoal: (): boolean => false,
    getHops: (): Hop[] => [],
    checkOwnerFreeReachability: true,
    forEachReachabilityHop(_state: NodeId, visit: HopVisitor): void {
      visit({ state: 1, distance: 1, owners: [] })
      returnedFromVisit = true
    },
  })).toThrow(callbackError)
  expect(returnedFromVisit).toBe(false)
})
