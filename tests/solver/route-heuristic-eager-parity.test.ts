import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createRouteHeuristicFixture } from "tests/fixtures/route-heuristic"

test("lazy heuristics preserve every eager distance across route changes", () => {
  const { topology, problem } = createRouteHeuristicFixture()
  const lazy = new TinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 0.25,
  })
  const eager = new TinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 0.25,
    USE_LAZY_ROUTE_HEURISTIC: false,
  })
  for (const routeId of [0, 1, 0, 1]) {
    lazy.state.currentRouteId = routeId
    eager.state.currentRouteId = routeId
    for (let portId = 0; portId < topology.portCount; portId++) {
      expect(lazy.computeH(portId)).toBe(eager.computeH(portId))
    }
  }
  expect(lazy.problemSetup.portHCostToEndOfRoute).toBeUndefined()
  expect(eager.problemSetup.portHCostToEndOfRoute).toHaveLength(8)
})
