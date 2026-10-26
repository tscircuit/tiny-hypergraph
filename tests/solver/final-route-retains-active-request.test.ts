import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("retaining completed routes keeps the active unfinished request queued", () => {
  const { solver, observations } =
    createFinalRouteCompletionHarness("active-route")
  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(observations[0].remainingRouteIds).toEqual([4, 2])
  expect(observations[0].segments).toEqual([
    [
      [0, 0, 1],
      [1, 2, 3],
    ],
  ])
  expect(solver.state.regionSegments).toEqual([
    [
      [0, 0, 1],
      [1, 2, 3],
      [4, 7, 8],
      [2, 4, 5],
    ],
  ])
  expect(solver.state.unroutedRoutes).toEqual([])
})
