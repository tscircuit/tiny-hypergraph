import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { RacingTinyHyperGraphSolver } from "../lib/racing-tiny-hypergraph-solver"
import { sameNetSharedBottleneckFixture } from "./fixtures/same-net-shared-bottleneck.fixture"

test("all four failed candidates fail the race without accepting partial routes", async (): Promise<void> => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const options = {
    MAX_ITERATIONS: 1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
  }
  const serial = new RacingTinyHyperGraphSolver(topology, problem, options)
  serial.solve()
  expect(serial.failed).toBe(true)
  expect(serial.solved).toBe(false)
  expect(serial.stats.raceCandidates).toHaveLength(4)
  const runtime = new SolverRuntime()
  try {
    const parallel = new RacingTinyHyperGraphSolver(topology, problem, options)
    await parallel.solveAsync(runtime)
    expect(parallel.failed).toBe(true)
    expect(parallel.solved).toBe(false)
    expect(parallel.error).toBe(serial.error)
    expect(parallel.stats.raceWinningCandidateIndex).toBeUndefined()
  } finally {
    await runtime.dispose()
  }
})
