import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { createParallelFixture } from "./fixture"

test("custom scoring keeps its original implementation without requesting base-formula tables", async (): Promise<void> => {
  const solver = createParallelFixture()
  const original = solver.computeG.bind(solver)
  solver.computeG = (...args): number => original(...args) + 0.123
  const runtime = { executeAsync: async (): Promise<never> => { throw new Error("should not dispatch") } } as SolverRuntimeExecutor
  const serial = createParallelFixture()
  const serialOriginal = serial.computeG.bind(serial)
  serial.computeG = (...args): number => serialOriginal(...args) + 0.123
  serial.solve()
  await solver.solveAsync(runtime)
  expect(solver.state.regionSegments).toEqual(serial.state.regionSegments)
  expect(solver.iterations).toBe(serial.iterations)
})
