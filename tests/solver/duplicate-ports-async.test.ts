import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { DuplicateCongestedPortSolver } from "../../lib/DuplicateCongestedPortSolver"
import { sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("independent route workers preserve port counts and duplicated topology", async () => {
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../fixtures/route-search.worker.ts", import.meta.url),
    requireWorker: true,
    startupFailure: "throw",
  })
  try {
    for (const useSerializedPortPenalties of [true, false]) {
      const create = () =>
        new DuplicateCongestedPortSolver(
          structuredClone(sectionSolverFixtureGraph),
          { useSerializedPortPenalties },
        )
      const serial = create()
      const parallel = create()
      serial.solve()
      await parallel.solveAsync(runtime)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.report).toEqual(serial.report)
      expect(parallel.getOutput()).toEqual(serial.getOutput())
      expect(parallel.stats).toEqual(serial.stats)
    }
  } finally {
    await runtime.dispose()
  }
})
