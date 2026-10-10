import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createRouteHeuristicFixture } from "tests/fixtures/route-heuristic"

test("resetForProblem invalidates memoized route endpoints", () => {
  const { topology, problem } = createRouteHeuristicFixture()
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.state.currentRouteId = 0
  const before = solver.computeH(0)
  const nextProblem = {
    ...problem,
    routeEndPort: new Int32Array([2, 1]),
  }
  solver.resetForProblem(nextProblem)
  solver.state.currentRouteId = 0
  const eager = new TinyHyperGraphSolver(topology, nextProblem, {
    USE_LAZY_ROUTE_HEURISTIC: false,
  })
  eager.state.currentRouteId = 0
  expect(solver.computeH(0)).toBe(eager.computeH(0))
  expect(solver.computeH(0)).not.toBe(before)
})
