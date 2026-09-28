import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
const [consumerArg, outputArg] = process.argv.slice(2)
if (!consumerArg || !outputArg)
  throw new Error("Usage: bun capture-inputs.mjs AUTOROUTER_REPO OUTPUT_DIR")
const consumer = resolve(consumerArg),
  output = resolve(outputArg)
const { DuplicateCongestedPortSolver: Duplicate } = await import(
  `${consumer}/node_modules/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts`
)
const { loadScenarioBySampleNumber } = await import(
  `${consumer}/scripts/benchmark/scenarios.ts`
)
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } =
  await import(
    `${consumer}/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts`
  )
const original = Duplicate.prototype.solve
let activeSample
Duplicate.prototype.solve = function () {
  this.options.routeSolveOptions = {
    ...this.options.routeSolveOptions,
    USE_LAZY_ROUTE_HEURISTIC: false,
  }
  writeFileSync(
    `${output}/sample-${activeSample}.json`,
    JSON.stringify(
      {
        sample: activeSample,
        graph: this.serializedHyperGraph,
        options: this.options,
      },
      (_, v) =>
        typeof v === "number" && !Number.isFinite(v)
          ? { __nonfinite: String(v) }
          : v,
    ),
  )
  return original.call(this)
}
try {
  for (const sample of [1, 2, 3, 4, 5]) {
    activeSample = sample
    const input = await loadScenarioBySampleNumber("srj18", sample, 1)
    writeFileSync(
      `${output}/scenario-${sample}.json`,
      JSON.stringify(input.scenario),
    )
    const solver = new Pipeline(input.scenario, { effort: 1 })
    const deadline = performance.now() + 60000
    while (!solver.portPointPathingSolver && !solver.solved && !solver.failed) {
      if (performance.now() > deadline)
        throw new Error(`Input capture timed out: ${sample}`)
      solver.step()
    }
    if (!solver.portPointPathingSolver)
      throw new Error(`Missing pathing input: ${sample}: ${solver.error}`)
  }
} finally {
  Duplicate.prototype.solve = original
}
