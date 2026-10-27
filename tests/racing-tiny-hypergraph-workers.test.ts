import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { RacingTinyHyperGraphSolver } from "../lib/racing-tiny-hypergraph-solver"
import { sameNetSharedBottleneckFixture } from "./fixtures/same-net-shared-bottleneck.fixture"

test("real worker pools with one, two and four workers preserve all routed output", async (): Promise<void> => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const options = {
    MAX_ITERATIONS: 20_000,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    raceUseSelectiveRerip: true,
  }
  const serial = new RacingTinyHyperGraphSolver(topology, problem, options)
  serial.solve()
  expect(serial.solved).toBe(true)
  for (const workerCount of [1, 2, 4]) {
    const runtime = new SolverRuntime({
      workerCount,
      workerUrl: new URL("./fixtures/race.worker.ts", import.meta.url),
      requireWorker: true,
      startupFailure: "throw",
    })
    try {
      const parallel = new RacingTinyHyperGraphSolver(topology, problem, options)
      await parallel.solveAsync(runtime)
      expect(parallel.solved).toBe(true)
      expect(parallel.stats.raceCandidateCount).toBe(4)
      expect(parallel.stats.raceWinningCandidateIndex).toBe(
        serial.stats.raceWinningCandidateIndex,
      )
      expect(parallel.getOutput()).toEqual(serial.getOutput())
      expect(parallel.iterations).toBe(serial.iterations)
    } finally {
      await runtime.dispose()
    }
  }
}, 30_000)
