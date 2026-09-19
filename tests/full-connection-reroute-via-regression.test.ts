import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { sample034 } from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../lib/section-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("rerouting cannot buy lower area-normalized cost with more vias or detours", () => {
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sample034,
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const scores = [
    pipeline.getStageOutput<SerializedHyperGraph>("optimizeSection")!,
    pipeline.getOutput()!,
  ].map((graph) => {
    const loaded = loadSerializedHyperGraph(graph)
    const solver = new TinyHyperGraphSectionSolver(
      loaded.topology,
      loaded.problem,
      loaded.solution,
    ).baselineSolver
    const caches = solver.state.regionIntersectionCaches
    return {
      max: Math.max(...caches.map((cache) => cache.existingRegionCost)),
      total: caches.reduce((sum, cache) => sum + cache.existingRegionCost, 0),
      vias: caches.reduce(
        (sum, cache) => sum + 2 * cache.existingSameLayerIntersections +
          cache.existingCrossingLayerIntersections +
          cache.existingEntryExitLayerChanges,
        0,
      ),
      layerChanges: caches.reduce(
        (sum, cache) => sum + cache.existingEntryExitLayerChanges,
        0,
      ),
      segments: solver.state.regionSegments.reduce(
        (sum, segments) => sum + segments.length,
        0,
      ),
    }
  })
  // The old maximum-first rule accepted a lower cost with 17 -> 20 estimated vias.
  expect(scores[0]!.vias).toBe(17)
  for (const key of ["max", "total", "vias", "layerChanges"] as const) {
    expect(scores[1]![key]).toBeLessThanOrEqual(scores[0]![key])
  }
  expect(scores[1]!.segments + 2 * scores[1]!.vias).toBeLessThanOrEqual(
    scores[0]!.segments + 2 * scores[0]!.vias,
  )
})
