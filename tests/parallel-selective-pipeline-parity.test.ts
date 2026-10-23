import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { ParallelSelectiveReripTinyHyperGraphSolver } from "../lib/parallel-selective-rerip-tiny-hypergraph-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { createPortfolioInput } from "./fixtures/createPortfolioInput"

class TestPipeline extends TinyHyperGraphSectionPipelineSolver {
  constructor() {
    super({
      serializedHyperGraph: {} as never,
      solveGraphOptions: createPortfolioInput().options,
    })
    this.pipelineDef = [
      {
        ...this.pipelineDef[0]!,
        solverClass: ParallelSelectiveReripTinyHyperGraphSolver,
      },
    ]
    this.MAX_ITERATIONS = 1000
  }

  override loadHyperGraph(): ReturnType<
    TinyHyperGraphSectionPipelineSolver["loadHyperGraph"]
  > {
    const input = createPortfolioInput()
    return {
      ...input,
      solution: {
        solvedRoutePathSegments: [
          [],
          [
            [3, 4],
            [4, 5],
          ],
        ],
      },
    }
  }
}

test("section pipeline async delegation preserves phase transitions and prefix budgets", async () => {
  const serial = new TestPipeline()
  serial.solve()
  expect(serial.solved).toBe(true)
  const runtime = new SolverRuntime()
  try {
    for (const prefix of [0, 1, 2, 3]) {
      const pipeline = new TestPipeline()
      await pipeline.solveAsync(runtime, prefix)
      const stepped = new TestPipeline()
      for (let i = 0; i < prefix; i++) stepped.step()
      expect(pipeline.iterations).toBe(stepped.iterations)
      expect(pipeline.activeSubSolver?.iterations).toBe(
        stepped.activeSubSolver?.iterations,
      )
      expect(pipeline.getOutput()).toEqual(stepped.getOutput())
      await pipeline.solveAsync(runtime)
      expect(pipeline.getOutput()).toEqual(serial.getOutput())
      expect(pipeline.iterations).toBe(serial.iterations)
      expect(pipeline.currentPipelineStageIndex).toBe(
        serial.currentPipelineStageIndex,
      )
    }
  } finally {
    await runtime.dispose()
  }
})
