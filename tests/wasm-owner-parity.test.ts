import { test, expect } from "bun:test"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerSearchOptions,
} from "../lib/find-distinct-owner-blocker-path"
import { findOwnerPathInWasm } from "../lib/parallel/findOwnerPathInWasm"
test("compiled owner labels preserve dominance, ties, budgets, and owner insertion order", () => {
  for (let seed = 1; seed <= 80; seed++) {
    let randomState = seed
    const random = () =>
      (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) /
      4294967296
    const graph = Array.from({ length: 24 }, () =>
      Array.from({ length: 4 }, () => ({
        state: Math.floor(random() * 24),
        distance: Math.floor(random() * 6),
        owners: Array.from({ length: Math.floor(random() * 4) }, () =>
          Math.floor(random() * 70),
        ),
      })),
    )
    for (const limit of [0, 3, 3000])
      for (const checkReachability of [false, true]) {
        const options: DistinctOwnerBlockerSearchOptions<
          number,
          number,
          number
        > = {
          start: 0,
          getStateKey: (x) => x,
          isGoal: (x) => x === 23,
          getHops: (x) => graph[x]!,
          maxExpandedLabels: limit,
          checkReachability,
        }
        expect(findOwnerPathInWasm(options)).toEqual(
          findDistinctOwnerBlockerPath(options),
        )
      }
  }
  for (const distance of [-1, Infinity, NaN])
    expect(() =>
      findOwnerPathInWasm({
        start: 0,
        getStateKey: (x) => x,
        isGoal: () => false,
        getHops: () => [{ state: 1, distance }],
      }),
    ).toThrow("finite distances")
})
