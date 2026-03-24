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
  finalMaxRegionCost: number
  delta: number
  activeRouteCount: number
  optimized: boolean
  selectedSectionCandidateLabel?: string
  selectedSectionCandidateFamily?: string
  sectionSearchCandidateCount: number
  solveGraphMs: number
  sectionSearchMs: number
  sectionSearchBaselineEvaluationMs: number
  sectionSearchCandidateEligibilityMs: number
  sectionSearchCandidateInitMs: number
  sectionSearchCandidateSolveMs: number
  sectionSearchCandidateReplayScoreMs: number
  optimizeSectionStageMs: number
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
  totalBaselineReplaySeconds: string
  totalFinalReplaySeconds: string
  totalPipelineSeconds: string
  averagePipelineSeconds: string
  averageSectionSearchSeconds: string
  totalCandidateCount: number
  averageAttemptedSectionSolves: string
  averageCandidateSeconds: string
  totalCandidateSolveSeconds: string
  totalCandidateReplayScoreSeconds: string
  totalCandidateInitSeconds: string
  totalCandidateEligibilitySeconds: string
}

const datasetModule = datasetHg07 as DatasetModule
const IMPROVEMENT_EPSILON = 1e-9
const SAMPLE_COUNT = 40

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
    finalMaxRegionCost: round(row.finalMaxRegionCost),
    delta: round(row.delta, 6),
    activeRouteCount: row.activeRouteCount,
    candidateCount: row.sectionSearchCandidateCount,
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
    baselineReplaySeconds: formatSecondsCell(row.baselineReplayMs),
    finalReplaySeconds: formatSecondsCell(row.finalReplayMs),
    candidateCount: row.sectionSearchCandidateCount,
    avgCandidateSeconds:
      row.sectionSearchCandidateCount > 0
        ? formatSecondsCell(row.sectionSearchMs / row.sectionSearchCandidateCount)
        : "0.00s",
    candidateSolveSeconds: formatSecondsCell(row.sectionSearchCandidateSolveMs),
  }))

console.log(
  "running hg-07 first 40 section pipeline benchmark (solveGraph -> optimizeSection)",
)

const sampleMetas = datasetModule.manifest.samples.slice(0, SAMPLE_COUNT)
const rows: PipelineBenchmarkRow[] = []
let improvedSampleCount = 0
let unchangedSampleCount = 0
let regressedSampleCount = 0
let failedSampleCount = 0
let totalDelta = 0
let totalSolveGraphMs = 0
let totalSectionSearchMs = 0
let totalOptimizeSectionStageMs = 0
let totalBaselineReplayMs = 0
let totalFinalReplayMs = 0
let totalPipelineMs = 0
let totalCandidateCount = 0
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
    const stageStats = pipelineSolver.getStageStats()

    if (!solveGraphSolver || !solveGraphOutput) {
      throw new Error("pipeline solveGraph stage did not produce a solver output")
    }

    if (!sectionSolver || !optimizeSectionOutput) {
      throw new Error(
        "pipeline optimizeSection stage did not produce a solver output",
      )
    }

    const baselineReplayStartTime = performance.now()
    const baselineMaxRegionCost =
      getSerializedOutputMaxRegionCost(solveGraphOutput)
    const baselineReplayMs = performance.now() - baselineReplayStartTime

    const finalReplayStartTime = performance.now()
    const finalMaxRegionCost =
      getSerializedOutputMaxRegionCost(optimizeSectionOutput)
    const finalReplayMs = performance.now() - finalReplayStartTime
    const delta = baselineMaxRegionCost - finalMaxRegionCost
    const optimized = delta > IMPROVEMENT_EPSILON
    const solveGraphMs = stageStats.solveGraph?.timeSpent ?? 0
    const optimizeSectionStageMs = stageStats.optimizeSection?.timeSpent ?? 0
    const sectionSearchMs = Number(pipelineSolver.stats.sectionSearchMs ?? 0)
    const sectionSearchCandidateCount = Number(
      pipelineSolver.stats.sectionSearchCandidateCount ?? 0,
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
    totalBaselineReplayMs += baselineReplayMs
    totalFinalReplayMs += finalReplayMs
    totalPipelineMs += pipelineMs
    totalCandidateCount += sectionSearchCandidateCount
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
      finalMaxRegionCost,
      delta,
      activeRouteCount: sectionSolver.activeRouteIds.length,
      optimized,
      selectedSectionCandidateLabel: pipelineSolver.selectedSectionCandidateLabel,
      selectedSectionCandidateFamily:
        pipelineSolver.selectedSectionCandidateFamily,
      sectionSearchCandidateCount,
      solveGraphMs,
      sectionSearchMs,
      sectionSearchBaselineEvaluationMs,
      sectionSearchCandidateEligibilityMs,
      sectionSearchCandidateInitMs,
      sectionSearchCandidateSolveMs,
      sectionSearchCandidateReplayScoreMs,
      optimizeSectionStageMs,
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
      finalMaxRegionCost: Number.NaN,
      delta: Number.NaN,
      activeRouteCount: 0,
      optimized: false,
      sectionSearchCandidateCount: 0,
      solveGraphMs: 0,
      sectionSearchMs: 0,
      sectionSearchBaselineEvaluationMs: 0,
      sectionSearchCandidateEligibilityMs: 0,
      sectionSearchCandidateInitMs: 0,
      sectionSearchCandidateSolveMs: 0,
      sectionSearchCandidateReplayScoreMs: 0,
      optimizeSectionStageMs: 0,
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
  totalBaselineReplaySeconds: formatSeconds(totalBaselineReplayMs),
  totalFinalReplaySeconds: formatSeconds(totalFinalReplayMs),
  totalPipelineSeconds: formatSeconds(totalPipelineMs),
  averagePipelineSeconds: formatSeconds(totalPipelineMs / solvedSampleCount),
  averageSectionSearchSeconds: formatSeconds(
    totalSectionSearchMs / solvedSampleCount,
  ),
  totalCandidateCount,
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
    key: "baselineReplaySeconds",
    value: summary.totalBaselineReplaySeconds,
  },
  { key: "finalReplaySeconds", value: summary.totalFinalReplaySeconds },
  { key: "averagePipelineSeconds", value: summary.averagePipelineSeconds },
  {
    key: "averageSectionSearchSeconds",
    value: summary.averageSectionSearchSeconds,
  },
  { key: "totalCandidateCount", value: String(summary.totalCandidateCount) },
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

console.log("hg-07 first 40 section pipeline benchmark")
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
