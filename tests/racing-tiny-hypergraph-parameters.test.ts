import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { createTinyHyperGraphRaceCandidate } from "../lib/racing-tiny-hypergraph-solver"
import { sameNetSharedBottleneckFixture } from "./fixtures/same-net-shared-bottleneck.fixture"

test("candidate zero preserves the baseline and exactly three alternatives have bounded effort", (): void => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const options = {
    MAX_ITERATIONS: 20_000,
    DISTANCE_TO_COST: 0.05,
    RIP_THRESHOLD_END: 0.8,
  }
  const candidates = [0, 1, 2, 3].map((index) =>
    createTinyHyperGraphRaceCandidate(topology, problem, options, index),
  )
  expect(candidates.map(({ MAX_ITERATIONS }) => MAX_ITERATIONS)).toEqual([
    20_000, 2_500, 2_500, 2_500,
  ])
  expect(candidates.map(({ DISTANCE_TO_COST }) => DISTANCE_TO_COST)).toEqual([
    0.05, 0.2, 0.5, 1,
  ])
  expect(
    candidates.every(({ RIP_THRESHOLD_END }) => RIP_THRESHOLD_END === 0.8),
  ).toBe(true)
  expect(candidates[0].state.unroutedRoutes).toEqual([0, 1])
  expect(candidates[1].state.unroutedRoutes).toEqual([1, 0])
  expect(() =>
    createTinyHyperGraphRaceCandidate(topology, problem, options, 4),
  ).toThrow("Invalid")
})
