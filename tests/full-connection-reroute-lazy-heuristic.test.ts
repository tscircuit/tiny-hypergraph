import { expect, test } from "bun:test"
import * as dataset from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

test("single-connection lazy heuristics preserve eager routes and scores", () => {
  for (const graph of [dataset.sample005, dataset.sample034, dataset.sample037, dataset.sample041, dataset.sample067]) {
    const pipeline = new TinyHyperGraphSectionPipelineSolver({ serializedHyperGraph: graph })
    pipeline.solve()
    const original = pipeline.getStageOutput<SerializedHyperGraph>("optimizeSection")!
    const runs = [false, undefined].map((lazy) => {
      const loaded = loadSerializedHyperGraph(original)
      const solver = new FullConnectionRerouteSolver(
        loaded.topology, loaded.problem, loaded.solution,
        { USE_LAZY_ROUTE_HEURISTIC: lazy }, {}, original,
      )
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      return solver
    })
    expect(runs[1]!.getOutput()).toEqual(runs[0]!.getOutput())
    for (const key of ["rerouteAttempts", "acceptedReroutes", "finalMaxRegionCost", "finalTotalRegionCost"]) {
      expect(runs[1]!.stats[key]).toBe(runs[0]!.stats[key])
    }
  }
})
