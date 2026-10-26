import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("cost-aware attempts without net progress leave the original greedy seed unchanged", () => {
  for (const mode of ["none", "equal-progress", "worse-progress"] as const) {
    const { solver, observations } = createFinalRouteCompletionHarness(mode)
    const originalSegments = structuredClone(solver.state.regionSegments)
    const originalAssignments = Array.from(solver.state.portAssignment)
    const originalCongestion = Array.from(solver.state.regionCongestionCost)
    solver.tryFinalAcceptance()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(observations).toHaveLength(1)
    expect(observations[0].remainingRouteIds).toEqual([1, 2, 4])
    expect(observations[0].segments).toEqual(originalSegments)
    expect(observations[0].portAssignment).toEqual(originalAssignments)
    expect(observations[0].congestion).toEqual(originalCongestion)
    expect(observations[0].cacheSegmentCount).toBe(1)
    expect(solver.state.regionSegments).toEqual([
      [
        [0, 0, 1],
        [1, 2, 3],
        [2, 4, 5],
        [4, 7, 8],
      ],
    ])
    expect(solver.stats.greedyFinalRouteRemainingRouteCount).toBe(3)
  }
})
