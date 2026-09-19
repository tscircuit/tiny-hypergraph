import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { sectionSolverFixtureGraph } from "./fixtures/section-solver.fixture"

test("batched rerouting retains the incumbent when attempts hit their iteration limit", () => {
  const loaded = loadSerializedHyperGraph(sectionSolverFixtureGraph)
  const solver = new FullConnectionRerouteSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
    {},
    { maxIterationsPerAttempt: 1, maxAttempts: 2 },
    sectionSolverFixtureGraph,
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.rerouteAttempts).toBe(2)
  expect(solver.stats.acceptedReroutes).toBe(0)
  expect(solver.getOutput()).toEqual(sectionSolverFixtureGraph)
  expect(solver.stats.finalMaxRegionCost).toBe(solver.stats.initialMaxRegionCost)
  expect(solver.stats.finalEstimatedViaCount).toBe(solver.stats.initialEstimatedViaCount)
})
