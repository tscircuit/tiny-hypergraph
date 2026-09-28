import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"

test("reachability follows the caller's forbidden-owner hop filtering", () => {
  const search = (forbiddenOwners: ReadonlySet<string>) =>
    findDistinctOwnerBlockerPath({
      start: 0,
      getStateKey: (state) => state,
      isGoal: (state) => state === 2,
      getHops: (state) =>
        state < 2
          ? [{ state: state + 1, distance: 1, owners: ["blocker"] }].filter(
              (hop) => !hop.owners.some((owner) => forbiddenOwners.has(owner)),
            )
          : [],
      checkReachability: true,
    })

  expect(search(new Set()).found).toBeTrue()
  expect(search(new Set(["blocker"]))).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 1,
  })
})
