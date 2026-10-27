import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { createParallelFixture } from "./fixture"

test("worker execution errors fail the solve and are never accepted as a serial result", async (): Promise<void> => {
  for (const started of [false, true]) {
    const solver = createParallelFixture()
    const runtime = {
      executeAsync: async (name: unknown, input: unknown): Promise<unknown> => {
        if (name === "TinyHyperGraphRegionCostCapabilities") return true
        if (started) {
          Atomics.add((input as { control: Int32Array }).control, 2, 1)
        }
        throw new Error("injected worker failure")
      },
    } as SolverRuntimeExecutor
    await expect(solver.solveAsync(runtime)).rejects.toThrow("injected worker failure")
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("injected worker failure")
  }
})
