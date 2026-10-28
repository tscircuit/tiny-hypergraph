import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("worker-prepared geometry preserves fixed copper costs and layer choices in reused worker pools", async () => {
  const runtime = new SolverRuntime({
    workerCount: 1,
    workerUrl: new URL("../fixtures/preparedRouting.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    for (const netId of [1, 0, -1]) {
      const serial = new PreparedPortPointRoutingSolver(createFixedCopperTopology(), createFixedCopperProblem([createFixedCopperSegment({netId})]))
      const worker = new PreparedPortPointRoutingSolver(createFixedCopperTopology(), createFixedCopperProblem([createFixedCopperSegment({netId})]))
      serial.solve()
      await worker.solveAsync(runtime)
      expect(worker.solved).toBe(true)
      expect(worker.state.regionSegments).toEqual(serial.state.regionSegments)
      expect(worker.state.portAssignment).toEqual(serial.state.portAssignment)
      expect(worker.stats).toEqual(serial.stats)
      expect(worker.iterations).toBe(serial.iterations)
    }
  } finally {
    await runtime.dispose()
  }
})
