import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as dataset from "dataset-hg07"
import { TinyHyperGraphSectionPipelineSolver } from "../../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { FullConnectionRerouteSolver } from "../../lib/full-connection-reroute-solver"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../../lib/section-solver"

// Run the same serialized section outputs through each revision for comparison.
const [mode, inputPath, resultPath] = process.argv.slice(2)
if (
  !inputPath ||
  !["prepare", "run"].includes(mode!) ||
  (mode === "run" && !resultPath)
) {
  throw new Error(
    "Usage: bun scripts/benchmarking/full-connection-reroute.ts prepare INPUTS.json | run INPUTS.json RESULTS.json",
  )
}
const inputs: Array<{ name: string; graph: SerializedHyperGraph }> =
  mode === "run" ? await Bun.file(inputPath).json() : []
if (mode === "prepare") {
  for (const [name, graph] of Object.entries(dataset)) {
    if (!/^sample\d+$/.test(name)) continue
    const pipeline = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: graph as SerializedHyperGraph,
    })
    pipeline.pipelineDef = pipeline.pipelineDef.filter(
      (stage) => stage.solverName !== "rerouteFullConnections",
    )
    try {
      pipeline.solve()
    } catch (error) {
      // Existing dataset endpoint-mapping failure, unrelated to rerouting.
      if (
        name !== "sample014" ||
        !String(error).includes("could not be mapped to route endpoints")
      )
        throw error
      console.error(name, String(error))
      continue
    }
    if (pipeline.failed) {
      throw new Error(`${name}: ${pipeline.error}`)
    }
    inputs.push({ name, graph: pipeline.getOutput()! })
  }
  await Bun.write(inputPath, JSON.stringify(inputs))
} else {
  const results = []
  for (const { name, graph } of inputs) {
    const loaded = loadSerializedHyperGraph(graph)
    const started = performance.now()
    const solver = new FullConnectionRerouteSolver(
      loaded.topology,
      loaded.problem,
      loaded.solution,
      {},
      {},
      graph,
    )
    solver.solve()
    const ms = performance.now() - started
    const replay = loadSerializedHyperGraph(solver.getOutput())
    const summary = new TinyHyperGraphSectionSolver(
      replay.topology,
      replay.problem,
      replay.solution,
    ).baselineSummary
    if (
      solver.failed ||
      !solver.solved ||
      solver.getOutput().solvedRoutes?.length !== loaded.problem.routeCount ||
      summary.maxRegionCost > Number(solver.stats.initialMaxRegionCost) ||
      (summary.maxRegionCost === Number(solver.stats.initialMaxRegionCost) &&
        summary.totalRegionCost > Number(solver.stats.initialTotalRegionCost))
    )
      throw new Error(`${name}: regression`)
    results.push({
      name,
      ms,
      ...solver.stats,
      score: summary,
      output: solver.getOutput(),
    })
  }
  await Bun.write(resultPath!, JSON.stringify(results))
  console.log(
    JSON.stringify({
      cases: results.length,
      ms: results.reduce((sum, row) => sum + row.ms, 0),
      maxCost:
        results.reduce((sum, row) => sum + row.score.maxRegionCost, 0) /
        results.length,
    }),
  )
}
