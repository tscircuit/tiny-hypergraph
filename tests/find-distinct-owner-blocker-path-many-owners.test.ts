import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("preserves distinct object owners beyond 64 bits", (): void => {
  const owners = Array.from({ length: 70 }, () => ({}))
  const goalOwner = owners.at(-1)!
  const sharedHops = owners.map((owner) => {
    let distance = 1
    if (owner === goalOwner) distance = 100
    return { state: "shared", distance, owners: [owner] }
  })
  const result = findDistinctOwnerBlockerPath({
    start: "start",
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => {
      if (state === "start") return sharedHops
      if (state === "shared") {
        return [{ state: "goal", distance: 1, owners: [goalOwner] }]
      }
      return []
    },
  })
  if (!result.found) throw new Error("Expected the one-owner path")
  expect(result.owners.size).toBe(1)
  expect(result.owners.has(goalOwner)).toBe(true)
  expect(result.distance).toBe(101)
  expect(result.states).toEqual(["start", "shared", "goal"])
})
