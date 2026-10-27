import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { StableInitialAssignmentsTinyHyperGraphSolver } from "../lib/stable-initial-assignments-tiny-hypergraph-solver"
import {
  RacingTinyHyperGraphSolver,
  createTinyHyperGraphRaceCandidate,
} from "../lib/racing-tiny-hypergraph-solver"
import { sameNetSharedBottleneckFixture } from "./fixtures/same-net-shared-bottleneck.fixture"

test("four preloaded-copper candidates preserve the original topology and acceptance", (): void => {
  const initial = loadSerializedHyperGraph(sameNetSharedBottleneckFixture)
  const options = {
    MAX_ITERATIONS: 20_000,
    raceUseSelectiveRerip: true,
  }
  const seed = new StableInitialAssignmentsTinyHyperGraphSolver(
    initial.topology,
    initial.problem,
    options,
  )
  seed.solve()
  expect(seed.solved).toBe(true)
  const { topology, problem } = loadSerializedHyperGraph(seed.getOutput())
  expect(problem.initialAssignments?.length).toBeGreaterThan(0)
  const baseline = new StableInitialAssignmentsTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  baseline.solve()
  const racing = new RacingTinyHyperGraphSolver(topology, problem, options)
  racing.solve()
  expect(racing.solved).toBe(true)
  expect(racing.stats.raceCandidateCount).toBe(4)
  expect(racing.stats.raceWinningCandidateIndex).toBe(0)
  expect(racing.getOutput()).toEqual(baseline.getOutput())
  const candidates = [0, 1, 2, 3].map((index) =>
    createTinyHyperGraphRaceCandidate(topology, problem, options, index),
  )
  expect(candidates.map(({ MAX_ITERATIONS }) => MAX_ITERATIONS)).toEqual([
    20_000, 2_500, 2_000, 1_667,
  ])
  expect(
    candidates.every(({ DISTANCE_TO_COST }) => DISTANCE_TO_COST === 0.05),
  ).toBe(true)
  expect(
    candidates
      .slice(1)
      .every(
        ({ ACCEPT_BEST_SOLUTION_ON_TIMEOUT }) =>
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT === false,
      ),
  ).toBe(true)
})
