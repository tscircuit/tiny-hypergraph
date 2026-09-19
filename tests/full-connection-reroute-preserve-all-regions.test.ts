import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { sample005 } from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("the physical-routing policy prevents congestion in previously clear regions", () => {
  const outputs = [false, true].map((preserveAllRegionCosts) => {
    const pipeline = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: sample005,
      fullConnectionRerouteOptions: { preserveAllRegionCosts },
    })
    pipeline.solve()
    expect(pipeline.solved).toBe(true)
    const original = pipeline.getStageOutput<SerializedHyperGraph>("optimizeSection")!
    const costs = [original, pipeline.getOutput()!].map((graph) => {
      const loaded = loadSerializedHyperGraph(graph)
      const solver = new TinyHyperGraphSectionSolver(
        loaded.topology,
        loaded.problem,
        loaded.solution,
      ).baselineSolver
      return solver.state.regionIntersectionCaches.map(
        (cache) => cache.existingRegionCost,
      )
    })
    return costs[1]!.some((cost, regionId) => cost > costs[0]![regionId]! + 1e-9)
  })
  expect(outputs).toEqual([true, false])
})
