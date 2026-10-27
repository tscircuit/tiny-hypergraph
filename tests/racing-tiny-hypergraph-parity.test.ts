import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import {
  RacingTinyHyperGraphSolver,
  TinyHyperGraphRaceCandidateSolver,
  type TinyHyperGraphRaceCandidateInput,
} from "../lib/racing-tiny-hypergraph-solver"
import { sameNetSharedBottleneckFixture } from "./fixtures/same-net-shared-bottleneck.fixture"

test("four candidates choose the same logical winner despite reversed completion order", async (): Promise<void> => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const options = {
    MAX_ITERATIONS: 20_000,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    raceUseSelectiveRerip: true,
  }
  const before = JSON.stringify({ topology, problem })
  const serial = new RacingTinyHyperGraphSolver(topology, problem, options)
  serial.solve()
  expect(serial.solved).toBe(true)
  const submissions: number[] = []
  const executor = {
    executeAsync: async (
      Solver: typeof TinyHyperGraphRaceCandidateSolver,
      input: TinyHyperGraphRaceCandidateInput,
    ) => {
      submissions.push(input.candidateIndex)
      await new Promise<void>((resolve) =>
        setTimeout(resolve, (3 - input.candidateIndex) * 10),
      )
      const solver = new Solver(input)
      solver.solve()
      return solver.getOutput()
    },
  } as SolverRuntimeExecutor
  const parallel = new RacingTinyHyperGraphSolver(topology, problem, options)
  await parallel.solveAsync(executor)
  expect(submissions).toEqual([0, 1, 2, 3])
  expect(parallel.solved).toBe(true)
  expect(parallel.getOutput()).toEqual(serial.getOutput())
  expect(parallel.stats.raceWinningCandidateIndex).toBe(
    serial.stats.raceWinningCandidateIndex,
  )
  expect(parallel.iterations).toBe(serial.iterations)
  const resumed = new RacingTinyHyperGraphSolver(topology, problem, options)
  resumed.step()
  await resumed.solveAsync(executor)
  expect(resumed.getOutput()).toEqual(serial.getOutput())
  expect(submissions).toHaveLength(4)
  expect(JSON.stringify({ topology, problem })).toBe(before)
})
