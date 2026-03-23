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

const getNumericArg = (flagName: string, fallback: number) => {
  const arg = Bun.argv.find((value) => value.startsWith(`${flagName}=`))
  const value = arg ? Number.parseInt(arg.slice(flagName.length + 1), 10) : NaN

  return Number.isFinite(value) ? value : fallback
}

const getFloatArg = (flagName: string, fallback: number) => {
  const arg = Bun.argv.find((value) => value.startsWith(`${flagName}=`))
  const value = arg ? Number.parseFloat(arg.slice(flagName.length + 1)) : NaN

  return Number.isFinite(value) ? value : fallback
}

const SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  attemptsPerSection: getNumericArg("--attempts-per-section", 8),
  maxSectionsToTry: getNumericArg("--max-sections-to-try", 50),
}

const requestedExpansionDegrees = getNumericArg("--expansion-degrees", -1)
if (requestedExpansionDegrees >= 0) {
  SECTION_SOLVER_OPTIONS.expansionDegrees = requestedExpansionDegrees
}

const requestedMaxIterationsPerSection = getNumericArg(
  "--max-iterations-per-section",
  -1,
)
if (requestedMaxIterationsPerSection >= 0) {
  SECTION_SOLVER_OPTIONS.maxIterationsPerSection =
    requestedMaxIterationsPerSection
}

const requestedMaxSectionOverlapCoverage = getFloatArg(
  "--max-section-overlap-coverage",
  -1,
)
if (requestedMaxSectionOverlapCoverage >= 0) {
  SECTION_SOLVER_OPTIONS.maxSectionOverlapCoverage =
    requestedMaxSectionOverlapCoverage
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

const datasetModule = datasetHg07 as DatasetModule
const requestedSampleCount = getNumericArg("--sample-count", 20)
const sampleCount = Number.isFinite(requestedSampleCount)
  ? Math.max(
      1,
      Math.min(datasetModule.manifest.samples.length, requestedSampleCount),
    )
  : 10
const sampleMetas = datasetModule.manifest.samples.slice(0, sampleCount)

const rows: ProfileRow[] = []
let initialFailureCount = 0
let sectionFailureCount = 0
let improvedSampleCount = 0
let totalInitialMs = 0
let totalSectionMs = 0
let maxInitialRegionCost = 0
let maxOptimizedRegionCost = 0
let loadFailureCount = 0
let totalBuildSectionSubProblemMs = 0
let totalSubsectionSolveMs = 0
let totalCandidateScoreMs = 0
let totalMergeSectionSolutionMs = 0
let totalReloadMergedSolutionMs = 0
let totalSkippedOverlappingSectionCount = 0

for (const sampleMeta of sampleMetas) {
  try {
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
      optimizedMaxRegionCost = sectionSolver.getCurrentMaxRegionCost()
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
    totalBuildSectionSubProblemMs += Number(
      sectionSolver?.stats.buildSectionSubProblemMs ?? 0,
    )
    totalSubsectionSolveMs += Number(
      sectionSolver?.stats.subsectionSolveMs ?? 0,
    )
    totalCandidateScoreMs += Number(sectionSolver?.stats.candidateScoreMs ?? 0)
    totalMergeSectionSolutionMs += Number(
      sectionSolver?.stats.mergeSectionSolutionMs ?? 0,
    )
    totalReloadMergedSolutionMs += Number(
      sectionSolver?.stats.reloadMergedSolutionMs ?? 0,
    )
    totalSkippedOverlappingSectionCount += Number(
      sectionSolver?.stats.skippedOverlappingSectionCount ?? 0,
    )
  } catch (error) {
    loadFailureCount += 1
    initialFailureCount += 1

    rows.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      initialMs: 0,
      sectionMs: 0,
      initialMaxRegionCost: Number.NaN,
      optimizedMaxRegionCost: Number.NaN,
      improved: false,
      sectionImprovements: 0,
      sectionAttempts: 0,
      solved: false,
    })
  }
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

console.log("hg-07 section optimization profile")
console.log(
  `samples=${rows.length} loadFailures=${loadFailureCount} initialFailures=${initialFailureCount} sectionFailures=${sectionFailureCount} improved=${improvedSampleCount}`,
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
      sampleCount,
      loadFailureCount,
      maxInitialRegionCost: Number(maxInitialRegionCost.toFixed(3)),
      maxOptimizedRegionCost: Number(maxOptimizedRegionCost.toFixed(3)),
      improvedSampleCount,
      sectionSolverOptions: SECTION_SOLVER_OPTIONS,
      sectionTimingBreakdownMs: {
        buildSectionSubProblemMs: Number(
          totalBuildSectionSubProblemMs.toFixed(2),
        ),
        subsectionSolveMs: Number(totalSubsectionSolveMs.toFixed(2)),
        candidateScoreMs: Number(totalCandidateScoreMs.toFixed(2)),
        mergeSectionSolutionMs: Number(totalMergeSectionSolutionMs.toFixed(2)),
        reloadMergedSolutionMs: Number(totalReloadMergedSolutionMs.toFixed(2)),
        skippedOverlappingSectionCount: totalSkippedOverlappingSectionCount,
      },
    },
    null,
    2,
  ),
)
