import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("failed greedy work cannot replace a cost-aware incumbent or add completion attempts", () => {
  const { solver, observations } = createFinalRouteCompletionHarness("failed-greedy", true)
  solver.state.ripCount = 32
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(false)
  expect(observations).toHaveLength(4)
  expect(observations.map((observation) => observation.attempt)).toEqual([0, 1, 2, 3])
  for (const observation of observations) {
    expect([...observation.remainingRouteIds].sort()).toEqual([1, 2, 4])
    expect(observation.maximumIterations).toBe(50_000)
    expect(observation.cacheSegmentCount).toBe(1)
  }
  expect(solver.state.ripCount).toBe(32)
  expect(solver.state.unroutedRoutes).toEqual([1, 2, 4])
})
