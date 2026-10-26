import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("weighted blocker hops receive the complete removal set of their current path", () => {
  const observed: Array<{ state: string; owners: string[] }> = []
  const result = findDistinctOwnerBlockerPath({
    start: "start",
    getStateKey: (state: string) => state,
    isGoal: (state: string) => state === "goal",
    checkReachability: true,
    getHops: (state: string, ignored?: ReadonlySet<string>) => {
      observed.push({ state, owners: [...(ignored ?? [])] })
      if (state === "start")
        return [{ state: "middle", distance: 1, owners: ["shared-owner"] }]
      if (state === "middle")
        return [
          {
            state: "goal",
            distance: 1,
            owners: ignored?.has("shared-owner")
              ? []
              : ["shared-owner", "extra-owner"],
          },
        ]
      return []
    },
  })
  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected a blocker path")
  expect([...result.owners]).toEqual(["shared-owner"])
  expect(result.distance).toBe(2)
  expect(observed).toContainEqual({ state: "middle", owners: ["shared-owner"] })
})
