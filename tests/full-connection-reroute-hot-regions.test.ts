import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { sample003 } from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("rerouting does not move congestion into another selected hot region", () => {
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sample003,
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const original = pipeline.getStageOutput<SerializedHyperGraph>("optimizeSection")!
  const output = pipeline.getOutput()!
  const costs = [original, output].map((graph) => {
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
  const hotRegions = costs[0]!
    .map((cost, regionId) => ({ cost, regionId }))
    .filter(({ cost }) => cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8)

  // The prior rule raised region 33 from 0.0488275 to 0.0569655 while
  // improving the graph's maximum, total cost, and estimated via count.
  expect(hotRegions.some(({ regionId }) => regionId === 33)).toBe(true)
  for (const { cost, regionId } of hotRegions) {
    expect(costs[1]![regionId]!).toBeLessThanOrEqual(cost + 1e-9)
  }
  expect(output.solvedRoutes).toHaveLength(original.solvedRoutes!.length)
})
