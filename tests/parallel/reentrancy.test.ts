import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { createParallelFixture } from "./fixture"

test("parallel solve rejects overlapping callers without cancelling the original caller", async (): Promise<void> => {
  const solver = createParallelFixture()
  let release!: (value: boolean) => void
  const capability = new Promise<boolean>((resolve) => { release = resolve })
  const runtime = { executeAsync: () => capability } as SolverRuntimeExecutor
  const pending = solver.solveAsync(runtime)
  await expect(solver.solveAsync(runtime)).rejects.toThrow("already running")
  release(false)
  await pending
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})
