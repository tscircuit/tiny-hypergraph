import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("preserves distinct object owners beyond 64 bits", () => {
  const owners = Array.from({ length: 70 }, () => ({}))
  const sharedHops = owners.map((owner, index) => {
    let distance = 1
    if (index === 69) distance = 100
    return { state: "shared", distance, owners: [owner] }
  })
  const result = findDistinctOwnerBlockerPath({
    start: "start",
    getStateKey: (state) => state,
    isGoal: (state) => state === "goal",
    getHops: (state) => {
      if (state === "start") return sharedHops
      if (state === "shared") {
        return [{ state: "goal", distance: 1, owners: [owners[69]] }]
      }
      return []
    },
  })
  if (!result.found) throw new Error("Expected the one-owner path")
  expect([...result.owners]).toEqual([owners[69]])
  expect(result.distance).toBe(101)
  expect(result.states).toEqual(["start", "shared", "goal"])
})
