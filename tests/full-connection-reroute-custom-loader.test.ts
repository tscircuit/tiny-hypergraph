import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { sectionSolverFixtureGraph } from "./fixtures/section-solver.fixture"

test("accepted reroutes retain caller-restored route metadata during replay", () => {
  let replayCount = 0
  const load = (graph: SerializedHyperGraph) => {
    replayCount++
    const loaded = loadSerializedHyperGraph(graph)
    for (const metadata of loaded.problem.routeMetadata!) {
      metadata.preloadedTraceSection = { traceId: metadata.connectionId }
    }
    return loaded
  }
  const loaded = load(sectionSolverFixtureGraph)
  const solver = new FullConnectionRerouteSolver(
    loaded.topology, loaded.problem, loaded.solution, {}, {}, sectionSolverFixtureGraph, load,
  )
  solver.solve()
  expect(solver.stats.acceptedReroutes).toBeGreaterThan(0)
  expect(replayCount).toBeGreaterThan(1)
  for (const metadata of solver.getSolvedSolver().problem.routeMetadata!) {
    expect(metadata.preloadedTraceSection).toEqual({ traceId: metadata.connectionId })
  }
})
