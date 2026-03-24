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
  solveGraphMs: number
  optimizeSectionMs: number
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
  elapsedMs: number
  totalSolveGraphMs: number
  totalOptimizeSectionMs: number
  totalPipelineMs: number
}

const datasetModule = datasetHg07 as DatasetModule
const IMPROVEMENT_EPSILON = 1e-9
const SAMPLE_COUNT = 40

const formatPct = (value: number) => `${value.toFixed(1)}%`
const formatSeconds = (value: number) => `${(value / 1000).toFixed(1)}s`
const round = (value: number, digits = 3) => Number(value.toFixed(digits))

const runWithoutSolverDebugLogs = <T>(fn: () => T): T => {
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    if (
      args[0] === "options" ||
      args[0] === "marking solved after"
    ) {
      return
    }

    originalLog(...args)
  }

  try {
    return fn()
  } finally {
    console.log = originalLog
  }
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) =>
  runWithoutSolverDebugLogs(() => {
    const { topology, problem, solution } =
      loadSerializedHyperGraph(serializedHyperGraph)
    const replaySolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      solution,
    )

    return getMaxRegionCost(replaySolver.baselineSolver)
  })

const formatRows = (rows: PipelineBenchmarkRow[]) =>
  rows.map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    baselineMaxRegionCost: Number.isFinite(row.baselineMaxRegionCost)
      ? round(row.baselineMaxRegionCost)
      : null,
    finalMaxRegionCost: Number.isFinite(row.finalMaxRegionCost)
      ? round(row.finalMaxRegionCost)
      : null,
    delta: Number.isFinite(row.delta) ? round(row.delta, 6) : null,
    activeRouteCount: row.activeRouteCount,
    optimized: row.optimized,
    solveGraphMs: round(row.solveGraphMs, 2),
    optimizeSectionMs: round(row.optimizeSectionMs, 2),
    pipelineMs: round(row.pipelineMs, 2),
    failed: row.failed ?? false,
    error: row.error ?? null,
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
let totalOptimizeSectionMs = 0
let totalPipelineMs = 0
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
    runWithoutSolverDebugLogs(() => pipelineSolver.solve())

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

    const baselineMaxRegionCost =
      getSerializedOutputMaxRegionCost(solveGraphOutput)
    const finalMaxRegionCost =
      getSerializedOutputMaxRegionCost(optimizeSectionOutput)
    const delta = baselineMaxRegionCost - finalMaxRegionCost
    const optimized = delta > IMPROVEMENT_EPSILON
    const solveGraphMs = stageStats.solveGraph?.timeSpent ?? 0
    const optimizeSectionMs = stageStats.optimizeSection?.timeSpent ?? 0
    const pipelineMs = performance.now() - sampleStartTime

    totalDelta += delta
    totalSolveGraphMs += solveGraphMs
    totalOptimizeSectionMs += optimizeSectionMs
    totalPipelineMs += pipelineMs

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
      solveGraphMs,
      optimizeSectionMs,
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
      `[${rows.length}/${sampleMetas.length} ${formatPct((rows.length / Math.max(sampleMetas.length, 1)) * 100)}] success=${formatPct((improvedSampleCount / Math.max(rows.length - failedSampleCount, 1)) * 100)} improved=${improvedSampleCount} unchanged=${unchangedSampleCount} regressed=${regressedSampleCount} failed=${failedSampleCount} last=${row.sample} ${outcome} elapsed=${formatSeconds(performance.now() - benchmarkStartTime)}`,
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
      solveGraphMs: 0,
      optimizeSectionMs: 0,
      pipelineMs: performance.now() - sampleStartTime,
      failed: true,
      error: String(error),
    }
    rows.push(row)

    console.log(
      `[${rows.length}/${sampleMetas.length} ${formatPct((rows.length / Math.max(sampleMetas.length, 1)) * 100)}] success=${formatPct((improvedSampleCount / Math.max(rows.length - failedSampleCount, 1)) * 100)} improved=${improvedSampleCount} unchanged=${unchangedSampleCount} regressed=${regressedSampleCount} failed=${failedSampleCount} last=${row.sample} failed elapsed=${formatSeconds(performance.now() - benchmarkStartTime)}`,
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
  elapsedMs: round(performance.now() - benchmarkStartTime, 2),
  totalSolveGraphMs: round(totalSolveGraphMs, 2),
  totalOptimizeSectionMs: round(totalOptimizeSectionMs, 2),
  totalPipelineMs: round(totalPipelineMs, 2),
}

const topImprovedRows = rows
  .filter((row) => Number.isFinite(row.delta) && row.delta > IMPROVEMENT_EPSILON)
  .sort((left, right) => right.delta - left.delta)
  .slice(0, 10)
  .map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    delta: round(row.delta, 6),
    baselineMaxRegionCost: round(row.baselineMaxRegionCost),
    finalMaxRegionCost: round(row.finalMaxRegionCost),
    activeRouteCount: row.activeRouteCount,
    solveGraphMs: round(row.solveGraphMs, 2),
    optimizeSectionMs: round(row.optimizeSectionMs, 2),
  }))

const topRegressedRows = rows
  .filter((row) => Number.isFinite(row.delta) && row.delta < -IMPROVEMENT_EPSILON)
  .sort((left, right) => left.delta - right.delta)
  .slice(0, 10)
  .map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    delta: round(row.delta, 6),
    baselineMaxRegionCost: round(row.baselineMaxRegionCost),
    finalMaxRegionCost: round(row.finalMaxRegionCost),
    activeRouteCount: row.activeRouteCount,
    solveGraphMs: round(row.solveGraphMs, 2),
    optimizeSectionMs: round(row.optimizeSectionMs, 2),
  }))

console.log("hg-07 first 40 section pipeline benchmark")
console.log(
  `samples=${summary.samples} improved=${summary.improvedSampleCount} unchanged=${summary.unchangedSampleCount} regressed=${summary.regressedSampleCount} failed=${summary.failedSampleCount}`,
)
console.table(formatRows(rows))
console.log("top improvements")
console.table(topImprovedRows)
console.log("top regressions")
console.table(topRegressedRows)
console.log(JSON.stringify(summary, null, 2))
