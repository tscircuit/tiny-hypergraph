import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("a search on its last initial route at mid-budget retains its ordinary plan", (): void => {
  const { topology, problem, options } = createPreparedRoutingFixture()
  problem.portPenalty = new Float64Array(topology.portCount).fill(2)
  const solver = new TinyHyperGraphSolver(topology, problem, {
    ...options,
    MAX_ITERATIONS: 80,
  })
  while (solver.iterations < solver.MAX_ITERATIONS / 2) solver.step()
  expect(solver.state.currentRouteId).toBeDefined()
  expect(solver.state.unroutedRoutes).toHaveLength(0)
  solver.solve()

  const reference = new TinyHyperGraphSolver(topology, problem, options)
  reference.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.portPenaltyHeuristicRefinementCount).toBeUndefined()
  expect(solver.state.regionSegments).toEqual(reference.state.regionSegments)
})
