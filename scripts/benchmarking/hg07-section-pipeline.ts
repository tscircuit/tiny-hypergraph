import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
} from "../../lib/index"

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

type PipelineBenchmarkRow = {
  sample: string
  circuit: string
  baselineMaxRegionCost: number
  sectionFinalMaxRegionCost: number
  finalMaxRegionCost: number
  sectionDelta: number
  delta: number
  unravelDelta: number
  activeRouteCount: number
  optimized: boolean
  selectedSectionCandidateLabel?: string
  selectedSectionCandidateFamily?: string
  sectionSearchGeneratedCandidateCount: number
  sectionSearchCandidateCount: number
  sectionSearchDuplicateCandidateCount: number
  solveGraphMs: number
  sectionSearchMs: number
  sectionSearchBaselineEvaluationMs: number
  sectionSearchCandidateEligibilityMs: number
  sectionSearchCandidateInitMs: number
  sectionSearchCandidateSolveMs: number
  sectionSearchCandidateReplayScoreMs: number
  optimizeSectionStageMs: number
  unravelStageMs: number
  baselineReplayMs: number
  finalReplayMs: number
  pipelineMs: number
  failed?: boolean
  error?: string
}

type PipelineBenchmarkSummary = {
  samples: number
  improvedSampleCount: number
  unchangedSampleCount: number
  regressedSampleCount: number
  failedSampleCount: number
  totalDelta: number
  avgMaxRegionDelta: number
  elapsedSeconds: string
  totalSolveGraphSeconds: string
  totalSectionSearchSeconds: string
  totalOptimizeSectionStageSeconds: string
  totalUnravelStageSeconds: string
  totalBaselineReplaySeconds: string
  totalFinalReplaySeconds: string
  totalPipelineSeconds: string
  averagePipelineSeconds: string
  averageSectionSearchSeconds: string
  totalGeneratedCandidateCount: number
  totalCandidateCount: number
  totalDuplicateCandidateCount: number
  averageAttemptedSectionSolves: string
  averageCandidateSeconds: string
  totalCandidateSolveSeconds: string
  totalCandidateReplayScoreSeconds: string
  totalCandidateInitSeconds: string
  totalCandidateEligibilitySeconds: string
}

const datasetModule = datasetHg07 as DatasetModule
const IMPROVEMENT_EPSILON = 1e-9

const parseLimitArg = () => {
  const limitIndex = process.argv.findIndex((arg) => arg === "--limit")
  if (limitIndex === -1) {
    return datasetModule.manifest.sampleCount
  }

  const rawLimit = process.argv[limitIndex + 1]
  const parsedLimit = Number(rawLimit)

  if (!rawLimit || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    throw new Error(`Invalid --limit value: ${rawLimit ?? "<missing>"}`)
  }

  return Math.min(Math.floor(parsedLimit), datasetModule.manifest.sampleCount)
}

const sampleCount = parseLimitArg()

const formatPct = (value: number) => `${value.toFixed(1)}%`
const formatSeconds = (value: number) => `${(value / 1000).toFixed(2)}s`
const round = (value: number, digits = 3) => Number(value.toFixed(digits))
const roundSeconds = (valueMs: number, digits = 2) =>
  Number((valueMs / 1000).toFixed(digits))
const formatSecondsCell = (valueMs: number) => `${(valueMs / 1000).toFixed(2)}s`

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) =>
  (() => {
    const { topology, problem, solution } =
      loadSerializedHyperGraph(serializedHyperGraph)
    const replaySolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      solution,
    )

    return getMaxRegionCost(replaySolver.baselineSolver)
  })()

const formatImprovementRows = (rows: PipelineBenchmarkRow[]) =>
  rows.map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    baselineMaxRegionCost: round(row.baselineMaxRegionCost),
    sectionFinalMaxRegionCost: round(row.sectionFinalMaxRegionCost),
    finalMaxRegionCost: round(row.finalMaxRegionCost),
    sectionDelta: round(row.sectionDelta, 6),
    delta: round(row.delta, 6),
    unravelDelta: round(row.unravelDelta, 6),
    activeRouteCount: row.activeRouteCount,
    generatedCandidateCount: row.sectionSearchGeneratedCandidateCount,
    candidateCount: row.sectionSearchCandidateCount,
    duplicateCandidateCount: row.sectionSearchDuplicateCandidateCount,
    selectedCandidate: row.selectedSectionCandidateLabel ?? null,
    family: row.selectedSectionCandidateFamily ?? null,
    pipelineSeconds: formatSecondsCell(row.pipelineMs),
  }))

const formatPerformanceRows = (rows: PipelineBenchmarkRow[]) =>
  rows.map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    pipelineSeconds: formatSecondsCell(row.pipelineMs),
    solveGraphSeconds: formatSecondsCell(row.solveGraphMs),
    sectionSearchSeconds: formatSecondsCell(row.sectionSearchMs),
    optimizeSectionStageSeconds: formatSecondsCell(row.optimizeSectionStageMs),
    unravelStageSeconds: formatSecondsCell(row.unravelStageMs),
    baselineReplaySeconds: formatSecondsCell(row.baselineReplayMs),
    finalReplaySeconds: formatSecondsCell(row.finalReplayMs),
    generatedCandidateCount: row.sectionSearchGeneratedCandidateCount,
    candidateCount: row.sectionSearchCandidateCount,
    duplicateCandidateCount: row.sectionSearchDuplicateCandidateCount,
    avgCandidateSeconds:
      row.sectionSearchCandidateCount > 0
        ? formatSecondsCell(row.sectionSearchMs / row.sectionSearchCandidateCount)
        : "0.00s",
    candidateSolveSeconds: formatSecondsCell(row.sectionSearchCandidateSolveMs),
  }))

console.log(
  `running hg-07 section pipeline benchmark (solveGraph -> optimizeSection -> unravel) sampleCount=${sampleCount}/${datasetModule.manifest.sampleCount}`,
)

const sampleMetas = datasetModule.manifest.samples.slice(0, sampleCount)
const rows: PipelineBenchmarkRow[] = []
let improvedSampleCount = 0
let unchangedSampleCount = 0
let regressedSampleCount = 0
let failedSampleCount = 0
let totalDelta = 0
let totalSolveGraphMs = 0
let totalSectionSearchMs = 0
let totalOptimizeSectionStageMs = 0
let totalUnravelStageMs = 0
let totalBaselineReplayMs = 0
let totalFinalReplayMs = 0
let totalPipelineMs = 0
let totalGeneratedCandidateCount = 0
let totalCandidateCount = 0
let totalDuplicateCandidateCount = 0
let totalCandidateSolveMs = 0
let totalCandidateReplayScoreMs = 0
let totalCandidateInitMs = 0
let totalCandidateEligibilityMs = 0
const benchmarkStartTime = performance.now()

for (const sampleMeta of sampleMetas) {
  const sampleStartTime = performance.now()
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph

  try {
    const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph,
    })
    pipelineSolver.solve()

    if (pipelineSolver.failed) {
      throw new Error(
        pipelineSolver.error ?? "section pipeline solver failed unexpectedly",
      )
    }

    const solveGraphSolver =
      pipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
    const sectionSolver =
      pipelineSolver.getSolver<TinyHyperGraphSectionSolver>("optimizeSection")
    const solveGraphOutput =
      pipelineSolver.getStageOutput<SerializedHyperGraph>("solveGraph")
    const optimizeSectionOutput =
      pipelineSolver.getStageOutput<SerializedHyperGraph>("optimizeSection")
    const unravelOutput =
      pipelineSolver.getStageOutput<SerializedHyperGraph>("unravel")
    const stageStats = pipelineSolver.getStageStats()

    if (!solveGraphSolver || !solveGraphOutput) {
      throw new Error("pipeline solveGraph stage did not produce a solver output")
    }

    if (!sectionSolver || !optimizeSectionOutput || !unravelOutput) {
      throw new Error(
        "pipeline optimizeSection/unravel stages did not produce solver outputs",
      )
    }

    const baselineReplayStartTime = performance.now()
    const baselineMaxRegionCost =
      getSerializedOutputMaxRegionCost(solveGraphOutput)
    const baselineReplayMs = performance.now() - baselineReplayStartTime

    const sectionFinalMaxRegionCost =
      getSerializedOutputMaxRegionCost(optimizeSectionOutput)
    const finalReplayStartTime = performance.now()
    const finalMaxRegionCost = getSerializedOutputMaxRegionCost(unravelOutput)
    const finalReplayMs = performance.now() - finalReplayStartTime
    const sectionDelta = baselineMaxRegionCost - sectionFinalMaxRegionCost
    const delta = baselineMaxRegionCost - finalMaxRegionCost
    const unravelDelta = sectionFinalMaxRegionCost - finalMaxRegionCost
    const optimized = delta > IMPROVEMENT_EPSILON
    const solveGraphMs = stageStats.solveGraph?.timeSpent ?? 0
    const optimizeSectionStageMs = stageStats.optimizeSection?.timeSpent ?? 0
    const unravelStageMs = stageStats.unravel?.timeSpent ?? 0
    const sectionSearchMs = Number(pipelineSolver.stats.sectionSearchMs ?? 0)
    const sectionSearchCandidateCount = Number(
      pipelineSolver.stats.sectionSearchCandidateCount ?? 0,
    )
    const sectionSearchGeneratedCandidateCount = Number(
      pipelineSolver.stats.sectionSearchGeneratedCandidateCount ?? 0,
    )
    const sectionSearchDuplicateCandidateCount = Number(
      pipelineSolver.stats.sectionSearchDuplicateCandidateCount ?? 0,
    )
    const sectionSearchBaselineEvaluationMs = Number(
      pipelineSolver.stats.sectionSearchBaselineEvaluationMs ?? 0,
    )
    const sectionSearchCandidateEligibilityMs = Number(
      pipelineSolver.stats.sectionSearchCandidateEligibilityMs ?? 0,
    )
    const sectionSearchCandidateInitMs = Number(
      pipelineSolver.stats.sectionSearchCandidateInitMs ?? 0,
    )
    const sectionSearchCandidateSolveMs = Number(
      pipelineSolver.stats.sectionSearchCandidateSolveMs ?? 0,
    )
    const sectionSearchCandidateReplayScoreMs = Number(
      pipelineSolver.stats.sectionSearchCandidateReplayScoreMs ?? 0,
    )
    const pipelineMs = performance.now() - sampleStartTime

    totalDelta += delta
    totalSolveGraphMs += solveGraphMs
    totalSectionSearchMs += sectionSearchMs
    totalOptimizeSectionStageMs += optimizeSectionStageMs
    totalUnravelStageMs += unravelStageMs
    totalBaselineReplayMs += baselineReplayMs
    totalFinalReplayMs += finalReplayMs
    totalPipelineMs += pipelineMs
    totalGeneratedCandidateCount += sectionSearchGeneratedCandidateCount
    totalCandidateCount += sectionSearchCandidateCount
    totalDuplicateCandidateCount += sectionSearchDuplicateCandidateCount
    totalCandidateSolveMs += sectionSearchCandidateSolveMs
    totalCandidateReplayScoreMs += sectionSearchCandidateReplayScoreMs
    totalCandidateInitMs += sectionSearchCandidateInitMs
    totalCandidateEligibilityMs += sectionSearchCandidateEligibilityMs

    if (optimized) {
      improvedSampleCount += 1
    } else if (delta < -IMPROVEMENT_EPSILON) {
      regressedSampleCount += 1
    } else {
      unchangedSampleCount += 1
    }

    const row: PipelineBenchmarkRow = {
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      baselineMaxRegionCost,
      sectionFinalMaxRegionCost,
      finalMaxRegionCost,
      sectionDelta,
      delta,
      unravelDelta,
      activeRouteCount: sectionSolver.activeRouteIds.length,
      optimized,
      selectedSectionCandidateLabel: pipelineSolver.selectedSectionCandidateLabel,
      selectedSectionCandidateFamily:
        pipelineSolver.selectedSectionCandidateFamily,
      sectionSearchGeneratedCandidateCount,
      sectionSearchCandidateCount,
      sectionSearchDuplicateCandidateCount,
      solveGraphMs,
      sectionSearchMs,
      sectionSearchBaselineEvaluationMs,
      sectionSearchCandidateEligibilityMs,
      sectionSearchCandidateInitMs,
      sectionSearchCandidateSolveMs,
      sectionSearchCandidateReplayScoreMs,
      optimizeSectionStageMs,
      unravelStageMs,
      baselineReplayMs,
      finalReplayMs,
      pipelineMs,
    }
    rows.push(row)

    const outcome =
      delta > IMPROVEMENT_EPSILON
        ? `improved delta=${row.delta.toFixed(6)}`
        : delta < -IMPROVEMENT_EPSILON
          ? `regressed delta=${row.delta.toFixed(6)}`
          : "unchanged"

    console.log(
      `[${rows.length}/${sampleMetas.length} ${formatPct((rows.length / Math.max(sampleMetas.length, 1)) * 100)}] success=${formatPct((improvedSampleCount / Math.max(rows.length - failedSampleCount, 1)) * 100)} improved=${improvedSampleCount} unchanged=${unchangedSampleCount} regressed=${regressedSampleCount} failed=${failedSampleCount} last=${row.sample} ${outcome} elapsed=${formatSeconds(performance.now() - benchmarkStartTime)} lastSample[attempts=${row.sectionSearchCandidateCount}]`,
    )
  } catch (error) {
    failedSampleCount += 1

    const row: PipelineBenchmarkRow = {
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      baselineMaxRegionCost: Number.NaN,
      sectionFinalMaxRegionCost: Number.NaN,
      finalMaxRegionCost: Number.NaN,
      sectionDelta: Number.NaN,
      delta: Number.NaN,
      unravelDelta: Number.NaN,
      activeRouteCount: 0,
      optimized: false,
      sectionSearchGeneratedCandidateCount: 0,
      sectionSearchCandidateCount: 0,
      sectionSearchDuplicateCandidateCount: 0,
      solveGraphMs: 0,
      sectionSearchMs: 0,
      sectionSearchBaselineEvaluationMs: 0,
      sectionSearchCandidateEligibilityMs: 0,
      sectionSearchCandidateInitMs: 0,
      sectionSearchCandidateSolveMs: 0,
      sectionSearchCandidateReplayScoreMs: 0,
      optimizeSectionStageMs: 0,
      unravelStageMs: 0,
      baselineReplayMs: 0,
      finalReplayMs: 0,
      pipelineMs: performance.now() - sampleStartTime,
      failed: true,
      error: String(error),
    }
    rows.push(row)

    console.log(
      `[${rows.length}/${sampleMetas.length} ${formatPct((rows.length / Math.max(sampleMetas.length, 1)) * 100)}] success=${formatPct((improvedSampleCount / Math.max(rows.length - failedSampleCount, 1)) * 100)} improved=${improvedSampleCount} unchanged=${unchangedSampleCount} regressed=${regressedSampleCount} failed=${failedSampleCount} last=${row.sample} failed elapsed=${formatSeconds(performance.now() - benchmarkStartTime)} lastSample[attempts=${row.sectionSearchCandidateCount}]`,
    )
  }
}

const solvedSampleCount = Math.max(rows.length - failedSampleCount, 1)
const summary: PipelineBenchmarkSummary = {
  samples: rows.length,
  improvedSampleCount,
  unchangedSampleCount,
  regressedSampleCount,
  failedSampleCount,
  totalDelta: round(totalDelta, 8),
  avgMaxRegionDelta: round(totalDelta / solvedSampleCount, 8),
  elapsedSeconds: formatSeconds(performance.now() - benchmarkStartTime),
  totalSolveGraphSeconds: formatSeconds(totalSolveGraphMs),
  totalSectionSearchSeconds: formatSeconds(totalSectionSearchMs),
  totalOptimizeSectionStageSeconds: formatSeconds(totalOptimizeSectionStageMs),
  totalUnravelStageSeconds: formatSeconds(totalUnravelStageMs),
  totalBaselineReplaySeconds: formatSeconds(totalBaselineReplayMs),
  totalFinalReplaySeconds: formatSeconds(totalFinalReplayMs),
  totalPipelineSeconds: formatSeconds(totalPipelineMs),
  averagePipelineSeconds: formatSeconds(totalPipelineMs / solvedSampleCount),
  averageSectionSearchSeconds: formatSeconds(
    totalSectionSearchMs / solvedSampleCount,
  ),
  totalGeneratedCandidateCount,
  totalCandidateCount,
  totalDuplicateCandidateCount,
  averageAttemptedSectionSolves: (
    totalCandidateCount / solvedSampleCount
  ).toFixed(2),
  averageCandidateSeconds:
    totalCandidateCount > 0
      ? formatSeconds(totalSectionSearchMs / totalCandidateCount)
      : "0.00s",
  totalCandidateSolveSeconds: formatSeconds(totalCandidateSolveMs),
  totalCandidateReplayScoreSeconds: formatSeconds(
    totalCandidateReplayScoreMs,
  ),
  totalCandidateInitSeconds: formatSeconds(totalCandidateInitMs),
  totalCandidateEligibilitySeconds: formatSeconds(
    totalCandidateEligibilityMs,
  ),
}

const topImprovedRows = rows
  .filter((row) => Number.isFinite(row.delta) && row.delta > IMPROVEMENT_EPSILON)
  .sort((left, right) => right.delta - left.delta)
  .slice(0, 10)
const slowestRows = rows
  .filter((row) => !row.failed)
  .sort((left, right) => right.pipelineMs - left.pipelineMs)
  .slice(0, 10)

const topRegressedRows = rows
  .filter((row) => Number.isFinite(row.delta) && row.delta < -IMPROVEMENT_EPSILON)
  .sort((left, right) => left.delta - right.delta)
  .slice(0, 10)
const performanceSummaryRows = [
  { key: "totalPipelineSeconds", value: summary.totalPipelineSeconds },
  { key: "solveGraphSeconds", value: summary.totalSolveGraphSeconds },
  { key: "sectionSearchSeconds", value: summary.totalSectionSearchSeconds },
  {
    key: "optimizeSectionStageSeconds",
    value: summary.totalOptimizeSectionStageSeconds,
  },
  {
    key: "unravelStageSeconds",
    value: summary.totalUnravelStageSeconds,
  },
  {
    key: "baselineReplaySeconds",
    value: summary.totalBaselineReplaySeconds,
  },
  { key: "finalReplaySeconds", value: summary.totalFinalReplaySeconds },
  { key: "averagePipelineSeconds", value: summary.averagePipelineSeconds },
  {
    key: "averageSectionSearchSeconds",
    value: summary.averageSectionSearchSeconds,
  },
  {
    key: "totalGeneratedCandidateCount",
    value: String(summary.totalGeneratedCandidateCount),
  },
  { key: "totalCandidateCount", value: String(summary.totalCandidateCount) },
  {
    key: "totalDuplicateCandidateCount",
    value: String(summary.totalDuplicateCandidateCount),
  },
  {
    key: "averageAttemptedSectionSolves",
    value: summary.averageAttemptedSectionSolves,
  },
  { key: "averageCandidateSeconds", value: summary.averageCandidateSeconds },
  { key: "candidateInitSeconds", value: summary.totalCandidateInitSeconds },
  { key: "candidateSolveSeconds", value: summary.totalCandidateSolveSeconds },
  {
    key: "candidateReplayScoreSeconds",
    value: summary.totalCandidateReplayScoreSeconds,
  },
  {
    key: "candidateEligibilitySeconds",
    value: summary.totalCandidateEligibilitySeconds,
  },
]

console.log("hg-07 section pipeline benchmark")
console.log(
  `samples=${summary.samples} improved=${summary.improvedSampleCount} unchanged=${summary.unchangedSampleCount} regressed=${summary.regressedSampleCount} failed=${summary.failedSampleCount}`,
)
console.log("top improvements")
console.table(formatImprovementRows(topImprovedRows))
console.log("slowest samples")
console.table(formatPerformanceRows(slowestRows))
console.log("performance summary")
console.table(performanceSummaryRows)
console.log("top regressions")
console.table(formatImprovementRows(topRegressedRows))
console.log(JSON.stringify(summary, null, 2))
