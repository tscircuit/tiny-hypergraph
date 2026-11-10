import { expect, test } from "bun:test"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import { solveWithParallelSearch } from "../lib/core-parallel"

test("exhausted asynchronous completion retains serial failure diagnostics and route state", async () => {
  const reference = createCompletionFixture(),
    actual = createCompletionFixture()
  for (const solver of [reference, actual]) {
    solver.MAX_ITERATIONS = 1
    for (const port of [4, 5, 6]) solver.problem.portSectionMask[port] = 0
  }
  reference.solve()
  const executor = createRouteSearchExecutor(1)
  try {
    await solveWithParallelSearch(actual, executor)
  } finally {
    executor.dispose()
  }
  expect(actual.solved).toBe(false)
  expect(actual.failed).toBe(reference.failed)
  expect(actual.error).toBe(reference.error)
  expect(actual.iterations).toBe(reference.iterations)
  expect(actual.state.regionSegments).toEqual(reference.state.regionSegments)
  for (const key of [
    "greedyFinalRouteAttemptCount",
    "greedyFinalRouteRemainingRouteCount",
    "greedyFinalRouteMaxIterations",
  ])
    expect(actual.stats[key]).toBe(reference.stats[key])
  expect(actual.deferFinalRouteAcceptance).toBe(false)
  expect(actual.hasDeferredFinalRouteAcceptance).toBe(false)
})
