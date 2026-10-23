import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import {
  ParallelSelectiveReripTinyHyperGraphSolver,
  TinyHyperGraphPortfolioLaneEvaluation,
} from "../lib/parallel-selective-rerip-tiny-hypergraph-solver"
import { createPortfolioInput } from "./fixtures/createPortfolioInput"

test("budget exhaustion is explicit and invariant errors reject the portfolio", async () => {
  const runtime = new SolverRuntime()
  try {
    const input = createPortfolioInput()
    input.options.MAX_ITERATIONS = 1
    const evaluation = await runtime.executeAsync(
      TinyHyperGraphPortfolioLaneEvaluation,
      { ...input, laneIndex: 0 },
    )
    expect(evaluation.status).toBe("failed")
    const solver = new ParallelSelectiveReripTinyHyperGraphSolver(
      input.topology,
      input.problem,
      input.options,
    )
    await expect(solver.solveAsync(runtime)).rejects.toThrow(
      "exhausted all candidate budgets",
    )
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    const malformed = createPortfolioInput()
    malformed.problem.initialAssignments![0]!.routeId = 100
    await expect(
      runtime.executeAsync(TinyHyperGraphPortfolioLaneEvaluation, {
        ...malformed,
        laneIndex: 0,
      }),
    ).rejects.toThrow()
  } finally {
    await runtime.dispose()
  }
})
