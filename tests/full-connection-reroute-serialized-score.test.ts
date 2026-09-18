import { expect, test } from "bun:test"
import * as dataset from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("rerouting never regresses the serialized output's whole-graph region score", () => {
  for (const graph of [dataset.sample034, dataset.sample037, dataset.sample041, dataset.sample067]) {
    const baseline = new TinyHyperGraphSectionPipelineSolver({ serializedHyperGraph: graph })
    const reroute = new TinyHyperGraphSectionPipelineSolver({ serializedHyperGraph: graph, fullConnectionReroute: {} })
    baseline.solve()
    reroute.solve()
    expect(baseline.solved).toBe(true)
    expect(reroute.solved).toBe(true)
    const summaries = [baseline, reroute].map((pipeline) => {
      const output = pipeline.getOutput()!
      expect(output.solvedRoutes!.length).toBe(graph.connections!.length)
      const loaded = loadSerializedHyperGraph(output)
      return new TinyHyperGraphSectionSolver(loaded.topology, loaded.problem, loaded.solution).baselineSummary
    })
    expect(summaries[1]!.maxRegionCost).toBeLessThanOrEqual(summaries[0]!.maxRegionCost)
    if (summaries[1]!.maxRegionCost === summaries[0]!.maxRegionCost) {
      expect(summaries[1]!.totalRegionCost).toBeLessThanOrEqual(summaries[0]!.totalRegionCost)
    }
  }
})
