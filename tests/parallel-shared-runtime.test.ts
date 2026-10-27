import { expect, test } from "bun:test"
import { solveWithParallelCosts } from "../lib/core-parallel"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import { createRegionCostExecutor } from "./fixtures/createRegionCostExecutor"

test("concurrent solves reserve one group of actual route workers at a time", async () => {
  const executor = createRegionCostExecutor(4)
  try {
    const reference = createCompletionFixture()
    reference.MAX_ITERATIONS = 1
    reference.solve()
    const solvers = [createCompletionFixture(), createCompletionFixture()]
    for (const solver of solvers) solver.MAX_ITERATIONS = 1
    await Promise.all(
      solvers.map((solver) => solveWithParallelCosts(solver, executor)),
    )
    expect(executor.maximumActive).toBe(4)
    expect(executor.submitted).toBeGreaterThanOrEqual(8)
    for (const solver of solvers) {
      expect(solver.solved).toBe(true)
      expect(solver.state.regionSegments).toEqual(
        reference.state.regionSegments,
      )
      expect(solver.iterations).toBe(reference.iterations)
    }
  } finally {
    executor.dispose()
  }
})
