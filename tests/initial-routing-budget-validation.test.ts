import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  getTinyHyperGraphSolverOptions,
} from "../lib/index"
import { createInitialRoutingBudgetProblem } from "./fixtures/initial-routing-budget.fixture"

test("initial-search budgets are explicit positive integers and round-trip", (): void => {
  const { topology, problem } = createInitialRoutingBudgetProblem()
  for (const budget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      () =>
        new TinyHyperGraphSolver(topology, problem, {
          INITIAL_ROUTING_MAX_ITERATIONS: budget,
        }),
    ).toThrow("INITIAL_ROUTING_MAX_ITERATIONS must be a positive safe integer")
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100,
    INITIAL_ROUTING_MAX_ITERATIONS: 1_600,
  })
  expect(
    getTinyHyperGraphSolverOptions(solver).INITIAL_ROUTING_MAX_ITERATIONS,
  ).toBe(1_600)
})
