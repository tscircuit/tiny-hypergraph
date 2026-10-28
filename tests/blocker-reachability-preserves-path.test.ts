import { expect, test } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"

test("reachability preserves the exact minimum-owner path and distance tie-break", () => {
  type State = "start" | "shared" | "goal"
  const hops: Record<State, DistinctOwnerBlockerHop<State, string>[]> = {
    start: [
      { state: "shared", distance: 1, owners: ["owner-b"] },
      { state: "shared", distance: 10, owners: ["owner-a"] },
      { state: "shared", distance: 12, owners: ["owner-a"] },
    ],
    shared: [{ state: "goal", distance: 1, owners: ["owner-a"] }],
    goal: [],
  }
  const options = {
    start: "start" as State,
    getStateKey: (state: State) => state,
    isGoal: (state: State) => state === "goal",
    getHops: (state: State) => hops[state],
  }
  const original = findDistinctOwnerBlockerPath(options)
  const checked = findDistinctOwnerBlockerPath({
    ...options,
    checkReachability: true,
  })

  expect(checked).toEqual(original)
  expect(checked.found).toBeTrue()
  if (!checked.found) throw new Error("Expected a path")
  expect([...checked.owners]).toEqual(["owner-a"])
  expect(checked.distance).toBe(11)
  expect(checked.hops).toEqual([hops.start[1], hops.shared[0]])
})
