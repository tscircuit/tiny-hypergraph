import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/index"

type DatasetModule = Record<string, unknown> & {
  manifest: {
    sampleCount: number
    samples: Array<{
      sampleName: string
      circuitKey: string
      circuitId: string
      stepsToPortPointSolve: number
    }>
  }
}

type ProfileRow = {
  sample: string
  circuit: string
  ms: number
  iterations: number
  referenceSteps: number
  solved: boolean
}

const datasetModule = datasetHg07 as DatasetModule
const sampleMetas = datasetModule.manifest.samples.slice(0, 10)

const rows: ProfileRow[] = []
let totalMs = 0
let totalIterations = 0
let totalReferenceSteps = 0
let failedSampleCount = 0

for (const sampleMeta of sampleMetas) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new TinyHyperGraphSolver(topology, problem)

  const startTime = performance.now()
  solver.solve()
  const elapsedMs = performance.now() - startTime

  const row: ProfileRow = {
    sample: sampleMeta.sampleName,
    circuit: sampleMeta.circuitId,
    ms: elapsedMs,
    iterations: solver.iterations,
    referenceSteps: sampleMeta.stepsToPortPointSolve,
    solved: solver.solved && !solver.failed,
  }

  rows.push(row)
  totalMs += elapsedMs
  totalIterations += row.iterations
  totalReferenceSteps += row.referenceSteps

  if (!row.solved) {
    failedSampleCount += 1
  }
}

const roundedRows = rows.map((row) => ({
  sample: row.sample,
  circuit: row.circuit,
  ms: Number(row.ms.toFixed(2)),
  iterations: row.iterations,
  referenceSteps: row.referenceSteps,
  solved: row.solved,
}))

console.log("hg-07 first 10 solve profile")
console.log(`samples=${rows.length} failed=${failedSampleCount}`)
console.table(roundedRows)
console.log(
  JSON.stringify(
    {
      totalMs: Number(totalMs.toFixed(2)),
      averageMs: Number((totalMs / Math.max(rows.length, 1)).toFixed(2)),
      totalIterations,
      averageIterations: Number(
        (totalIterations / Math.max(rows.length, 1)).toFixed(1),
      ),
      totalReferenceSteps,
    },
    null,
    2,
  ),
)
