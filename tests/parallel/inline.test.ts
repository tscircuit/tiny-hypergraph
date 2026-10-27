import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { createParallelFixture } from "./fixture"

test("an inline executor runs the serial loop without entering the worker service", async (): Promise<void> => {
  const serial = createParallelFixture()
  serial.solve()
  const parallel = createParallelFixture()
  const runtime = new SolverRuntime()
  try {
    await parallel.solveAsync(runtime)
    expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
    expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
    expect(parallel.state.regionIntersectionCaches).toEqual(serial.state.regionIntersectionCaches)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.stats.parallelRegionCostWorkers).toBeUndefined()
  } finally { await runtime.dispose() }
})
