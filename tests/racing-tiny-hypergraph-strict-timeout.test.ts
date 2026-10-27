import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import {
  RacingTinyHyperGraphSolver,
  createTinyHyperGraphRaceCandidate,
} from "../lib/racing-tiny-hypergraph-solver"
import { sameNetSharedBottleneckFixture } from "./fixtures/same-net-shared-bottleneck.fixture"

test("bounded speculative searches cannot win through native timeout acceptance", (): void => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const options = {
    MAX_ITERATIONS: 1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  }
  const baseline = createTinyHyperGraphRaceCandidate(
    topology,
    problem,
    options,
    0,
  )
  baseline.solve()
  expect(baseline.solved).toBe(true)
  for (const index of [1, 2, 3]) {
    const alternative = createTinyHyperGraphRaceCandidate(
      topology,
      problem,
      options,
      index,
    )
    alternative.solve()
    expect(alternative.failed).toBe(true)
    expect(alternative.solved).toBe(false)
  }
  const racing = new RacingTinyHyperGraphSolver(topology, problem, options)
  racing.solve()
  expect(racing.solved).toBe(true)
  expect(racing.stats.raceWinningCandidateIndex).toBe(0)
  expect(racing.getOutput()).toEqual(baseline.getOutput())
})
