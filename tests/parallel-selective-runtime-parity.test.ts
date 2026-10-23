import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { SolverRuntime as BunRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { ParallelSelectiveReripTinyHyperGraphSolver } from "../lib/parallel-selective-rerip-tiny-hypergraph-solver"
import { createPortfolioInput } from "./fixtures/createPortfolioInput"

const createSolver = (): ParallelSelectiveReripTinyHyperGraphSolver => {
  const { topology, problem, options } = createPortfolioInput()
  return new ParallelSelectiveReripTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
}

const comparable = (
  solver: ParallelSelectiveReripTinyHyperGraphSolver,
): unknown => ({
  output: solver.solved && !solver.failed ? solver.getOutput() : null,
  state: solver.state,
  stats: solver.stats,
  iterations: solver.iterations,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
})

test("portfolio serial, inline, worker, and resumed-prefix results match exactly", async () => {
  const serial = createSolver()
  serial.solve()
  expect(serial.solved).toBe(true)
  const expected = comparable(serial)
  const inline = new SolverRuntime()
  const workers = new BunRuntime({
    workerCount: 4,
    workerUrl: new URL(
      "./fixtures/portfolioRuntime.worker.ts",
      import.meta.url,
    ),
    requireWorker: true,
  })
  try {
    for (const runtime of [inline, workers]) {
      const solver = createSolver()
      await solver.solveAsync(runtime)
      expect(comparable(solver)).toEqual(expected)
      const resumed = createSolver()
      await resumed.solveAsync(runtime, 1)
      const prefix = createSolver()
      prefix.step()
      expect(comparable(resumed)).toEqual(comparable(prefix))
      await resumed.solveAsync(runtime)
      expect(comparable(resumed)).toEqual(expected)
    }
    expect(serial.stats.portfolioLaneCount).toBe(1)
    expect(
      serial.state.regionSegments.flat().filter(([route]) => route === 1),
    ).toHaveLength(2)
  } finally {
    await inline.dispose()
    await workers.dispose()
  }
})
