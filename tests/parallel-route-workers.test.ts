import { expect, test } from "bun:test"
import { solveWithParallelSearch } from "../lib/core-parallel"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("TypeScript route workers retain exact completion output and iteration budgets", async () => {
  const executor = createRouteSearchExecutor(4)
  try {
    const baseline = createCompletionFixture(),
      parallel = createCompletionFixture()
    baseline.MAX_ITERATIONS = parallel.MAX_ITERATIONS = 1
    baseline.solve()
    await solveWithParallelSearch(parallel, executor)
    expect(executor.submitted).toBeGreaterThan(0)
    expect(executor.maximumActive).toBe(4)
    expect(parallel.solved).toBe(baseline.solved)
    expect(parallel.failed).toBe(baseline.failed)
    expect(parallel.iterations).toBe(baseline.iterations)
    expect(parallel.state.regionIntersectionCaches).toEqual(
      baseline.state.regionIntersectionCaches,
    )
    expect(parallel.state.regionSegments).toEqual(baseline.state.regionSegments)
    expect(parallel.state.portAssignment).toEqual(baseline.state.portAssignment)
  } finally {
    executor.dispose()
  }
})
