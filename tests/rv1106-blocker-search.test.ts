import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import {
  findDistinctOwnerBlockerPath,
  type DistinctOwnerBlockerHop,
} from "lib/find-distinct-owner-blocker-path"

// Captured from the remaining-net phase of the 50 mm RV1106 board.
// Full board snapshot: solver/__snapshots__/rv1106-full-board.snap.svg.
// Run with `bun test tests/rv1106-blocker-search.test.ts` to compare timings.
test("reproduces the RV1106 distinct-owner blocker search", async () => {
  const compressed = await Bun.file(
    new URL("./fixtures/rv1106-blocker-search.json.gz", import.meta.url),
  ).arrayBuffer()
  const fixture: {
    start: number
    goal: number
    hopsByState: Record<number, DistinctOwnerBlockerHop<number, number>[]>
    expected: {
      owners: number[]
      distance: number
      expandedLabelCount: number
      states: number[]
    }
  } = JSON.parse(gunzipSync(compressed).toString())

  const result = findDistinctOwnerBlockerPath({
    start: fixture.start,
    getStateKey: (state) => state,
    isGoal: (state) => state === fixture.goal,
    getHops: (state) => fixture.hopsByState[state],
  })
  if (!result.found) throw new Error(`Search failed: ${result.reason}`)
  expect([...result.owners]).toEqual(fixture.expected.owners)
  expect(result.distance).toBe(fixture.expected.distance)
  expect(result.expandedLabelCount).toBe(fixture.expected.expandedLabelCount)
  expect(result.states).toEqual(fixture.expected.states)
})
