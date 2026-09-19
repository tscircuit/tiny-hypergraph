import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { sectionSolverFixtureGraph } from "./fixtures/section-solver.fixture"

test("the early score check cannot bypass caller-restored replay costs", () => {
  const loaded = loadSerializedHyperGraph(sectionSolverFixtureGraph)
  let replayCount = 0
  const load = (graph: SerializedHyperGraph) => {
    replayCount++
    const replay = loadSerializedHyperGraph(graph)
    // Make the replay require layer changes even though the candidate was
    // promising on the original single-layer topology.
    replay.topology.portZ.forEach((_, index) => {
      replay.topology.portZ[index] = index % 2
    })
    return replay
  }
  const solver = new FullConnectionRerouteSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
    {},
    {},
    sectionSolverFixtureGraph,
    load,
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(replayCount).toBeGreaterThan(0)
  expect(solver.stats.acceptedReroutes).toBe(0)
  expect(solver.getOutput()).toEqual(sectionSolverFixtureGraph)
})
