import { expect, spyOn, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createRouteHeuristicFixture } from "tests/fixtures/route-heuristic"

test("lazy heuristics memoize repeated port queries without a route-port matrix", () => {
  const { topology, problem } = createRouteHeuristicFixture()
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.state.currentRouteId = 0
  const sqrt = spyOn(Math, "sqrt")
  try {
    const first = solver.computeH(0)
    expect(solver.computeH(0)).toBe(first)
    expect(sqrt).toHaveBeenCalledTimes(1)
    solver.state.currentRouteId = 1
    const second = solver.computeH(0)
    expect(second).not.toBe(first)
    expect(solver.computeH(0)).toBe(second)
    expect(sqrt).toHaveBeenCalledTimes(2)
    solver.state.currentRouteId = 0
    expect(solver.computeH(0)).toBe(first)
    expect(sqrt).toHaveBeenCalledTimes(3)
    expect(solver.problemSetup.portHCostToEndOfRoute).toBeUndefined()
  } finally {
    sqrt.mockRestore()
  }
})
