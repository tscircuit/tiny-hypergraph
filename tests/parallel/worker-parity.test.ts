import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { createParallelFixture } from "./fixture"

test("worker costs preserve routes, search iterations and costs with one or three service workers", async (): Promise<void> => {
  const serial = createParallelFixture()
  serial.solve()
  for (const workerCount of [1, 3]) {
    const runtime = new SolverRuntime({ workerCount, workerUrl: new URL("./worker.ts", import.meta.url), requireWorker: true })
    try {
      const parallel = createParallelFixture()
      await parallel.solveAsync(runtime)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
    expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
    expect(parallel.state.regionIntersectionCaches).toEqual(serial.state.regionIntersectionCaches)
      expect(parallel.state.regionCongestionCost).toEqual(serial.state.regionCongestionCost)
      expect(parallel.stats.parallelRegionCostCompletedTables).toBeGreaterThan(0)
      expect(parallel.stats.parallelRegionCostRowsUsed).toBeGreaterThan(0)
    } finally { await runtime.dispose() }
  }
})
