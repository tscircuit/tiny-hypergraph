import { expect, test } from "bun:test"
import { createFinalRouteCompletionHarness } from "../fixtures/finalRouteCompletionHarness"

test("existing final attempts retain only strict cost-aware progress including reripped seeds", () => {
  for (const mode of ["partial", "active-route", "reripped-seed", "none", "equal-progress", "worse-progress"] as const) {
    const { solver, observations } = createFinalRouteCompletionHarness(mode, true)
    solver.tryFinalAcceptance()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(observations).toHaveLength(1)
    const expected = mode === "partial" ? [2, 4] : mode === "active-route" ? [4, 2] : mode === "reripped-seed" ? [4, 0] : [1, 2, 4]
    expect(observations[0]!.remainingRouteIds).toEqual(expected)
    expect(observations[0]!.maximumIterations).toBe(50_000)
    expect(solver.MAX_ITERATIONS).toBe(2_000_000)
    expect(solver.state.unroutedRoutes).toEqual([])
  }
})
