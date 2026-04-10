import { writeFileSync } from "node:fs"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { runAutomaticSectionSearchWithWorkers } from "../../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

type DatasetModule = Record<string, unknown> & {
  manifest: {
    sampleCount: number
    samples: Array<{
      sampleName: string
      circuitId: string
    }>
  }
}

const datasetModule = datasetHg07 as DatasetModule
const sampleMetas = datasetModule.manifest.samples.slice(0, 10)

const rows: Array<{
  sample: string
  circuit: string
  beforeMs: number
  afterMs: number
  speedupPct: number
}> = []

for (const sampleMeta of sampleMetas) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)

  const solvedSolver = new TinyHyperGraphSolver(topology, problem)
  solvedSolver.solve()
  const solvedSerializedHyperGraph = solvedSolver.getOutput()
  const solved = loadSerializedHyperGraph(solvedSerializedHyperGraph)

  const beforeStart = performance.now()
  await runAutomaticSectionSearchWithWorkers(
    solvedSolver,
    solved.topology,
    solved.problem,
    solved.solution,
    { workerCount: 1 },
    {},
  )
  const beforeMs = performance.now() - beforeStart

  const afterStart = performance.now()
  await runAutomaticSectionSearchWithWorkers(
    solvedSolver,
    solved.topology,
    solved.problem,
    solved.solution,
    { workerCount: 4 },
    {},
  )
  const afterMs = performance.now() - afterStart

  rows.push({
    sample: sampleMeta.sampleName,
    circuit: sampleMeta.circuitId,
    beforeMs,
    afterMs,
    speedupPct: beforeMs > 0 ? ((beforeMs - afterMs) / beforeMs) * 100 : 0,
  })
}

const roundedRows = rows.map((row) => ({
  sample: row.sample,
  circuit: row.circuit,
  beforeMs: Number(row.beforeMs.toFixed(2)),
  afterMs: Number(row.afterMs.toFixed(2)),
  speedupPct: Number(row.speedupPct.toFixed(2)),
}))

console.table(roundedRows)

const md = [
  "# hg07 first 10 worker comparison",
  "",
  "| sample | circuit | before_ms | after_ms | speedup_pct |",
  "| --- | --- | ---: | ---: | ---: |",
  ...roundedRows.map(
    (row) =>
      `| ${row.sample} | ${row.circuit} | ${row.beforeMs} | ${row.afterMs} | ${row.speedupPct} |`,
  ),
].join("\n")

writeFileSync(
  "scripts/benchmarking/hg07-first10-worker-comparison.md",
  `${md}\n`,
)
console.log("wrote scripts/benchmarking/hg07-first10-worker-comparison.md")
