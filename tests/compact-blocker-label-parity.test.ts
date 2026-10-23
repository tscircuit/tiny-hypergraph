import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "../lib/find-distinct-owner-blocker-path"
import { findDistinctOwnerBlockerPath as referenceSearch } from "./fixtures/referenceDistinctOwnerBlockerPath"

test("compact owner labels preserve stable paths, owner identity and expansion budgets", () => {
  let seed = 749
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const owners: unknown[] = [0, 1, 2, 3, 4, 5, NaN, "a", "b", {}, {}]
  for (let trial = 0; trial < 2500; trial++) {
    const size = 5 + Math.floor(random() * 30)
    const graph = Array.from({ length: size }, () =>
      Array.from({ length: Math.floor(random() * 8) }, () => ({
        state: Math.floor(random() * size),
        distance: Math.floor(random() * 15) / 4,
        owners: Array.from(
          { length: Math.floor(random() * 4) },
          () => owners[Math.floor(random() * owners.length)],
        ),
      })),
    )
    const options = {
      start: 0,
      getStateKey: (state: number): number => state,
      isGoal: (state: number): boolean => state === size - 1,
      getHops: (state: number): (typeof graph)[number] => graph[state],
      maxExpandedLabels: Math.floor(random() * 1000),
      checkReachability: random() < 0.5,
    }
    expect(findDistinctOwnerBlockerPath(options)).toEqual(
      referenceSearch(options),
    )
  }
})

test("wide distance queues preserve ties across radix boundaries and owner classes", () => {
  for (let trial = 0; trial < 24; trial++) {
    const width = 320
    const goal = width + 1
    const distances = [0, Number.MIN_VALUE, 0.125, 1, 2, 2 ** 31, 2 ** 60]
    const options = {
      start: 0,
      getStateKey: (state: number): number => state,
      isGoal: (state: number): boolean => state === goal,
      getHops: (state: number) => state === 0
        ? Array.from({ length: width }, (_, index) => ({
          state: index + 1,
          distance: distances[(index * 17 + trial) % distances.length]!,
          owners: trial % 2 ? [index % 3] : [],
        }))
        : [{ state: goal, distance: distances[(state + trial) % distances.length]!, owners: [trial % 3] }],
      maxExpandedLabels: trial % 3 === 0 ? width / 2 : width * 4,
    }
    expect(findDistinctOwnerBlockerPath(options)).toEqual(referenceSearch(options))
  }
})
