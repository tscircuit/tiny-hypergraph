import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import {
  mandatoryPortPenaltyProblem,
  mandatoryPortPenaltyTopology,
} from "tests/fixtures/mandatory-port-penalty.fixture"

test("routes through a mandatory penalized port before exhausting cheap dead ends", () => {
  const solver = new DistanceAwareTinyHyperGraphSolver(
    mandatoryPortPenaltyTopology,
    mandatoryPortPenaltyProblem,
    {
      MAX_ITERATIONS: 12,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
    },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.regionSegments[1]).toEqual([[0, 1, 2]])
  expect(
    getSvgFromGraphicsObject(solver.visualize(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
