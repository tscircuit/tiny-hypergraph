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
    const options = {
      routeSolveOptions: {
        MAX_ITERATIONS: 1,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      },
    }
    const serial = new DuplicateCongestedPortSolver(
      structuredClone(sectionSolverFixtureGraph),
      options,
    )
    const parallel = new DuplicateCongestedPortSolver(
      structuredClone(sectionSolverFixtureGraph),
      options,
    )
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(serial.failed).toBe(true)
    expect(parallel.failed).toBe(true)
    expect(parallel.error).toBe(serial.error)
    expect(parallel.report).toEqual(serial.report)
  } finally {
    await runtime.dispose()
  }
})
