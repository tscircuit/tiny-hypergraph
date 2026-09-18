import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { sectionSolverFixtureGraph } from "./fixtures/section-solver.fixture"

test("full-connection rerouting avoids hot regions and only accepts whole-graph improvements", () => {
  const graph = structuredClone(sectionSolverFixtureGraph)
  const { topology, problem, solution } = loadSerializedHyperGraph(graph)
  const solver = new FullConnectionRerouteSolver(topology, problem, solution)
  const before = solver.getOutput()
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedReroutes).toBeGreaterThan(0)
  expect(solver.stats.reroutedRouteCount).toBeGreaterThan(0)
  expect(solver.stats.reroutedRouteCount).toBeLessThanOrEqual(
    solver.stats.acceptedReroutes,
  )
  expect(solver.stats.finalMaxRegionCost).toBeLessThan(
    solver.stats.initialMaxRegionCost,
  )
  expect(solver.getOutput().solvedRoutes?.length).toBe(problem.routeCount)
  expect(graph).toEqual(sectionSolverFixtureGraph)
  expect(before).not.toEqual(solver.getOutput())

  // No candidate can finish within one iteration; the complete incumbent survives.
  const rejected = new FullConnectionRerouteSolver(
    topology,
    problem,
    solution,
    {},
    { maxIterationsPerAttempt: 1 },
  )
  const original = rejected.getOutput()
  rejected.solve()
  expect(rejected.stats.acceptedReroutes).toBe(0)
  expect(rejected.stats.reroutedRouteCount).toBe(0)
  expect(rejected.getOutput()).toEqual(original)
})
