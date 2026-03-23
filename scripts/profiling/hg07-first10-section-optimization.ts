import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/index"
import { TinyHyperGraphSectionOptimizationPipelineSolver } from "../../lib/section-optimization-pipeline"
import type { TinyHyperGraphSectionSolverOptions } from "../../lib/section-solver"

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
  initialMs: number
  sectionMs: number
  initialMaxRegionCost: number
  optimizedMaxRegionCost: number
  improved: boolean
  sectionImprovements: number
  sectionAttempts: number
  solved: boolean
}

const SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  attemptsPerSection: 3,
  maxSectionsToTry: 20,
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

const datasetModule = datasetHg07 as DatasetModule
const sampleMetas = datasetModule.manifest.samples.slice(0, 10)

const rows: ProfileRow[] = []
let initialFailureCount = 0
let sectionFailureCount = 0
let improvedSampleCount = 0
let totalInitialMs = 0
let totalSectionMs = 0
let maxInitialRegionCost = 0
let maxOptimizedRegionCost = 0

for (const sampleMeta of sampleMetas) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const pipeline = new TinyHyperGraphSectionOptimizationPipelineSolver({
    topology,
    problem,
    sectionSolverOptions: SECTION_SOLVER_OPTIONS,
  })

  pipeline.solve()

  const initialSolver = pipeline.getInitialSolveSolver()
  const sectionSolver = pipeline.getSectionOptimizationSolver()
  const stageStats = pipeline.getStageStats()
  const initialMs = stageStats.initialSolver?.timeSpent ?? 0
  const sectionMs = stageStats.sectionSolver?.timeSpent ?? 0

  if (!initialSolver || !initialSolver.solved || initialSolver.failed) {
    initialFailureCount += 1
    rows.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      initialMs,
      sectionMs: 0,
      initialMaxRegionCost: Number.NaN,
      optimizedMaxRegionCost: Number.NaN,
      improved: false,
      sectionImprovements: 0,
      sectionAttempts: 0,
      solved: false,
    })
    continue
  }

  const initialMaxRegionCost = getMaxRegionCost(initialSolver)

  let optimizedMaxRegionCost = initialMaxRegionCost
  let solved = pipeline.solved && !pipeline.failed

  if (!sectionSolver || sectionSolver.failed) {
    sectionFailureCount += 1
    solved = false
  } else {
    optimizedMaxRegionCost = getMaxRegionCost(
      sectionSolver.currentSolutionSolver,
    )
  }

  const improved = optimizedMaxRegionCost < initialMaxRegionCost
  if (improved) {
    improvedSampleCount += 1
  }

  rows.push({
    sample: sampleMeta.sampleName,
    circuit: sampleMeta.circuitId,
    initialMs,
    sectionMs,
    initialMaxRegionCost,
    optimizedMaxRegionCost,
    improved,
    sectionImprovements: Number(sectionSolver?.stats.improvementCount ?? 0),
    sectionAttempts: Number(sectionSolver?.stats.sectionAttemptCount ?? 0),
    solved,
  })

  totalInitialMs += initialMs
  totalSectionMs += sectionMs
  maxInitialRegionCost = Math.max(maxInitialRegionCost, initialMaxRegionCost)
  maxOptimizedRegionCost = Math.max(
    maxOptimizedRegionCost,
    optimizedMaxRegionCost,
  )
}

const roundedRows = rows.map((row) => ({
  sample: row.sample,
  circuit: row.circuit,
  initialMs: Number(row.initialMs.toFixed(2)),
  sectionMs: Number(row.sectionMs.toFixed(2)),
  initialMaxRegionCost: Number(row.initialMaxRegionCost.toFixed(3)),
  optimizedMaxRegionCost: Number(row.optimizedMaxRegionCost.toFixed(3)),
  improved: row.improved,
  sectionImprovements: row.sectionImprovements,
  sectionAttempts: row.sectionAttempts,
  solved: row.solved,
}))

console.log("hg-07 first 10 section optimization profile")
console.log(
  `samples=${rows.length} initialFailures=${initialFailureCount} sectionFailures=${sectionFailureCount} improved=${improvedSampleCount}`,
)
console.table(roundedRows)
console.log(
  JSON.stringify(
    {
      totalInitialMs: Number(totalInitialMs.toFixed(2)),
      totalSectionMs: Number(totalSectionMs.toFixed(2)),
      averageInitialMs: Number(
        (totalInitialMs / Math.max(rows.length, 1)).toFixed(2),
      ),
      averageSectionMs: Number(
        (totalSectionMs / Math.max(rows.length, 1)).toFixed(2),
      ),
      maxInitialRegionCost: Number(maxInitialRegionCost.toFixed(3)),
      maxOptimizedRegionCost: Number(maxOptimizedRegionCost.toFixed(3)),
      improvedSampleCount,
      sectionSolverOptions: SECTION_SOLVER_OPTIONS,
    },
    null,
    2,
  ),
)
