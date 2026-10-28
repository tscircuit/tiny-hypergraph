import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("explicit current-route widths take precedence over the board minimum in finite-width copper costs", () => {
  const problem = createFixedCopperProblem([createFixedCopperSegment({y1: 0.25})])
  problem.routeMetadata = [{simpleRouteConnection: {nominalTraceWidth: 0.1}}]
  const solver = new TinyHyperGraphSolver(createFixedCopperTopology(), problem)
  solver.state.currentRouteId = 0
  expect(solver.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBe(0)
  problem.routeMetadata[0].simpleRouteConnection.nominalTraceWidth = 0.4
  expect(solver.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBeGreaterThan(0)
  problem.routeMetadata[0].simpleRouteConnection = {width: 0.4}
  expect(solver.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBeGreaterThan(0)
  problem.routeMetadata[0].simpleRouteConnection = {width: NaN}
  expect(() => solver.computeFixedCopperTransitionCost(1, 0, 1, 0)).toThrow("invalid explicit trace width")
})
