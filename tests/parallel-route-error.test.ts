import { expect, test } from "bun:test"
import { solveWithWasmRoutes } from "../lib/parallel/solveWithWasmRoutes"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"

test("route worker errors propagate and release deferred acceptance", async () => {
  const solver = createCompletionFixture(), error = new Error("worker transport failed")
  await expect(solveWithWasmRoutes(solver, { persistentWorkerCount: 4, executeAsync: async () => { throw error } })).rejects.toBe(error)
  expect(solver.deferFinalRouteAcceptance).toBe(false)
  expect(solver.hasDeferredFinalRouteAcceptance).toBe(false)
  expect(solver.solved).toBe(false)
})
