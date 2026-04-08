import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  DEFAULT_UNRAVEL_SOLVER_OPTIONS,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphUnravelSolver,
  type TinyHyperGraphUnravelSolverOptions,
  type TinyHyperGraphSolver as TinyHyperGraphSolvedSolver,
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

export type UnravelBenchmarkRow = {
  sample: string
  circuit: string
  baselineMaxRegionCost: number
  sectionFinalMaxRegionCost: number
  unravelFinalMaxRegionCost: number
  sectionDelta: number
  unravelDelta: number
  unravelVsSectionDelta: number
  betterThanSection: boolean
  solveGraphMs: number
  sectionPipelineMs: number
  unravelSearchMs: number
  unravelTotalMs: number
  mutationDepth: number
  searchStatesExpanded: number
  generatedCandidateCount: number
  attemptedCandidateCount: number
  successfulMutationCount: number
  bestMutationPathLabels: string[]
  failed?: boolean
  error?: string
}

export type UnravelBenchmarkSummary = {
  samples: number
  improvedVsBaselineCount: number
  betterThanSectionCount: number
  matchedSectionCount: number
  regressedVsSectionCount: number
  failedSampleCount: number
  totalSectionDelta: number
  totalUnravelDelta: number
  totalUnravelVsSectionDelta: number
  avgSectionDelta: number
  avgUnravelDelta: number
  avgUnravelVsSectionDelta: number
  elapsedMs: number
  totalSolveGraphMs: number
  totalSectionPipelineMs: number
  totalUnravelSearchMs: number
  totalUnravelTotalMs: number
  averageMutationDepth: number
  averageStatesExpanded: number
}

export type UnravelBenchmarkResult = {
  config: UnravelBenchmarkConfig
  rows: UnravelBenchmarkRow[]
  topUnravelRows: Array<{
    sample: string
    circuit: string
    baselineMaxRegionCost: number
    sectionFinalMaxRegionCost: number
    unravelFinalMaxRegionCost: number
    unravelDelta: number
    unravelVsSectionDelta: number
    betterThanSection: boolean
    mutationDepth: number
  }>
  summary: UnravelBenchmarkSummary
}

export type UnravelBenchmarkConfig = {
  sampleCount: number
  unravelOptions: TinyHyperGraphUnravelSolverOptions
}

export type UnravelBenchmarkProgress = {
  row: UnravelBenchmarkRow
  completedSamples: number
  totalSamples: number
  progressPct: number
  elapsedMs: number
  improvedVsBaselineCount: number
  betterThanSectionCount: number
  failedSampleCount: number
}

type UnravelBenchmarkOptions = {
  onProgress?: (progress: UnravelBenchmarkProgress) => void
}

const datasetModule = datasetHg07 as DatasetModule
const IMPROVEMENT_EPSILON = 1e-9

export const defaultUnravelBenchmarkConfig: UnravelBenchmarkConfig = {
  sampleCount: 20,
  unravelOptions: {
    MAX_MUTATION_DEPTH: DEFAULT_UNRAVEL_SOLVER_OPTIONS.MAX_MUTATION_DEPTH,
    MAX_SEARCH_STATES: DEFAULT_UNRAVEL_SOLVER_OPTIONS.MAX_SEARCH_STATES,
    MAX_ENQUEUED_MUTATIONS_PER_STATE:
      DEFAULT_UNRAVEL_SOLVER_OPTIONS.MAX_ENQUEUED_MUTATIONS_PER_STATE,
    MAX_SECTIONS: DEFAULT_UNRAVEL_SOLVER_OPTIONS.MAX_SECTIONS,
    MAX_SECTION_ATTEMPTS_PER_ROOT_REGION:
      DEFAULT_UNRAVEL_SOLVER_OPTIONS.MAX_SECTION_ATTEMPTS_PER_ROOT_REGION,
    MIN_ROOT_REGION_COST: DEFAULT_UNRAVEL_SOLVER_OPTIONS.MIN_ROOT_REGION_COST,
  },
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits))

const getMaxRegionCost = (solver: TinyHyperGraphSolvedSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
}

export const formatUnravelBenchmarkRows = (rows: UnravelBenchmarkRow[]) =>
  rows.map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    baselineMaxRegionCost: Number.isFinite(row.baselineMaxRegionCost)
      ? round(row.baselineMaxRegionCost)
      : null,
    sectionFinalMaxRegionCost: Number.isFinite(row.sectionFinalMaxRegionCost)
      ? round(row.sectionFinalMaxRegionCost)
      : null,
    unravelFinalMaxRegionCost: Number.isFinite(row.unravelFinalMaxRegionCost)
      ? round(row.unravelFinalMaxRegionCost)
      : null,
    sectionDelta: Number.isFinite(row.sectionDelta) ? round(row.sectionDelta) : null,
    unravelDelta: Number.isFinite(row.unravelDelta) ? round(row.unravelDelta) : null,
    unravelVsSectionDelta: Number.isFinite(row.unravelVsSectionDelta)
      ? round(row.unravelVsSectionDelta)
      : null,
    betterThanSection: row.betterThanSection,
    mutationDepth: row.mutationDepth,
    searchStatesExpanded: row.searchStatesExpanded,
    generatedCandidateCount: row.generatedCandidateCount,
    attemptedCandidateCount: row.attemptedCandidateCount,
    successfulMutationCount: row.successfulMutationCount,
    failed: row.failed ?? false,
    error: row.error ?? null,
  }))

export const runUnravelBenchmark = (
  inputConfig: Partial<UnravelBenchmarkConfig> = {},
  options: UnravelBenchmarkOptions = {},
): UnravelBenchmarkResult => {
  const config: UnravelBenchmarkConfig = {
    ...defaultUnravelBenchmarkConfig,
    ...inputConfig,
    unravelOptions: {
      ...defaultUnravelBenchmarkConfig.unravelOptions,
      ...inputConfig.unravelOptions,
    },
  }

  const sampleMetas = datasetModule.manifest.samples.slice(0, config.sampleCount)
  const benchmarkRows: UnravelBenchmarkRow[] = []
  let improvedVsBaselineCount = 0
  let betterThanSectionCount = 0
  let matchedSectionCount = 0
  let regressedVsSectionCount = 0
  let failedSampleCount = 0
  let totalSectionDelta = 0
  let totalUnravelDelta = 0
  let totalUnravelVsSectionDelta = 0
  let totalSolveGraphMs = 0
  let totalSectionPipelineMs = 0
  let totalUnravelSearchMs = 0
  let totalUnravelTotalMs = 0
  let totalMutationDepth = 0
  let totalStatesExpanded = 0
  const benchmarkStartTime = performance.now()

  for (const sampleMeta of sampleMetas) {
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      const sectionPipelineStartTime = performance.now()
      const sectionPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
        serializedHyperGraph,
        unravelSolverOptions: config.unravelOptions,
      })
      sectionPipelineSolver.solve()
      const sectionPipelineMs = performance.now() - sectionPipelineStartTime
      totalSectionPipelineMs += sectionPipelineMs

      if (sectionPipelineSolver.failed) {
        throw new Error(
          sectionPipelineSolver.error ??
            "section pipeline solver failed unexpectedly",
        )
      }

      const solveGraphOutput =
        sectionPipelineSolver.getStageOutput<SerializedHyperGraph>("solveGraph")
      const optimizeSectionOutput =
        sectionPipelineSolver.getStageOutput<SerializedHyperGraph>(
          "optimizeSection",
        )
      const unravelOutput =
        sectionPipelineSolver.getStageOutput<SerializedHyperGraph>("unravel")
      const unravelSolver =
        sectionPipelineSolver.getSolver<TinyHyperGraphUnravelSolver>("unravel")
      const stageStats = sectionPipelineSolver.getStageStats()

      if (
        !solveGraphOutput ||
        !optimizeSectionOutput ||
        !unravelOutput ||
        !unravelSolver
      ) {
        throw new Error("pipeline did not produce solveGraph/optimize/unravel outputs")
      }

      const solveGraphMs = stageStats.solveGraph?.timeSpent ?? 0
      const optimizeSectionMs = stageStats.optimizeSection?.timeSpent ?? 0
      const unravelSearchMs = stageStats.unravel?.timeSpent ?? 0
      totalSolveGraphMs += solveGraphMs
      totalUnravelSearchMs += unravelSearchMs
      totalUnravelTotalMs += optimizeSectionMs + unravelSearchMs

      const baselineMaxRegionCost =
        getSerializedOutputMaxRegionCost(solveGraphOutput)
      const sectionFinalMaxRegionCost =
        getSerializedOutputMaxRegionCost(optimizeSectionOutput)
      const unravelFinalMaxRegionCost =
        getSerializedOutputMaxRegionCost(unravelOutput)

      if (unravelSolver.failed) {
        throw new Error(
          unravelSolver.error ?? "unravel stage failed unexpectedly",
        )
      }

      const sectionDelta = baselineMaxRegionCost - sectionFinalMaxRegionCost
      const unravelDelta = baselineMaxRegionCost - unravelFinalMaxRegionCost
      const unravelVsSectionDelta =
        sectionFinalMaxRegionCost - unravelFinalMaxRegionCost
      const betterThanSection =
        unravelVsSectionDelta > IMPROVEMENT_EPSILON

      totalSectionDelta += sectionDelta
      totalUnravelDelta += unravelDelta
      totalUnravelVsSectionDelta += unravelVsSectionDelta
      totalMutationDepth += Number(unravelSolver.stats.mutationDepth ?? 0)
      totalStatesExpanded += Number(
        unravelSolver.stats.searchStatesExpanded ?? 0,
      )

      if (unravelDelta > IMPROVEMENT_EPSILON) {
        improvedVsBaselineCount += 1
      }
      if (betterThanSection) {
        betterThanSectionCount += 1
      } else if (Math.abs(unravelVsSectionDelta) <= IMPROVEMENT_EPSILON) {
        matchedSectionCount += 1
      } else {
        regressedVsSectionCount += 1
      }

      benchmarkRows.push({
        sample: sampleMeta.sampleName,
        circuit: sampleMeta.circuitId,
        baselineMaxRegionCost,
        sectionFinalMaxRegionCost,
        unravelFinalMaxRegionCost,
        sectionDelta,
        unravelDelta,
        unravelVsSectionDelta,
        betterThanSection,
        solveGraphMs,
        sectionPipelineMs,
        unravelSearchMs,
        unravelTotalMs: optimizeSectionMs + unravelSearchMs,
        mutationDepth: Number(unravelSolver.stats.mutationDepth ?? 0),
        searchStatesExpanded: Number(
          unravelSolver.stats.searchStatesExpanded ?? 0,
        ),
        generatedCandidateCount: Number(
          unravelSolver.stats.generatedCandidateCount ?? 0,
        ),
        attemptedCandidateCount: Number(
          unravelSolver.stats.attemptedCandidateCount ?? 0,
        ),
        successfulMutationCount: Number(
          unravelSolver.stats.successfulMutationCount ?? 0,
        ),
        bestMutationPathLabels: Array.isArray(
          unravelSolver.stats.mutationPathLabels,
        )
          ? (unravelSolver.stats.mutationPathLabels as string[])
          : [],
      })
      options.onProgress?.({
        row: benchmarkRows[benchmarkRows.length - 1]!,
        completedSamples: benchmarkRows.length,
        totalSamples: sampleMetas.length,
        progressPct: (benchmarkRows.length / Math.max(sampleMetas.length, 1)) * 100,
        elapsedMs: performance.now() - benchmarkStartTime,
        improvedVsBaselineCount,
        betterThanSectionCount,
        failedSampleCount,
      })
    } catch (error) {
      failedSampleCount += 1
      benchmarkRows.push({
        sample: sampleMeta.sampleName,
        circuit: sampleMeta.circuitId,
        baselineMaxRegionCost: Number.NaN,
        sectionFinalMaxRegionCost: Number.NaN,
        unravelFinalMaxRegionCost: Number.NaN,
        sectionDelta: Number.NaN,
        unravelDelta: Number.NaN,
        unravelVsSectionDelta: Number.NaN,
        betterThanSection: false,
        solveGraphMs: Number.NaN,
        sectionPipelineMs: Number.NaN,
        unravelSearchMs: Number.NaN,
        unravelTotalMs: Number.NaN,
        mutationDepth: 0,
        searchStatesExpanded: 0,
        generatedCandidateCount: 0,
        attemptedCandidateCount: 0,
        successfulMutationCount: 0,
        bestMutationPathLabels: [],
        failed: true,
        error: String(error),
      })
      options.onProgress?.({
        row: benchmarkRows[benchmarkRows.length - 1]!,
        completedSamples: benchmarkRows.length,
        totalSamples: sampleMetas.length,
        progressPct: (benchmarkRows.length / Math.max(sampleMetas.length, 1)) * 100,
        elapsedMs: performance.now() - benchmarkStartTime,
        improvedVsBaselineCount,
        betterThanSectionCount,
        failedSampleCount,
      })
    }
  }

  const benchmarkElapsedMs = performance.now() - benchmarkStartTime
  const solvedSampleCount = Math.max(
    benchmarkRows.length - failedSampleCount,
    1,
  )
  const topUnravelRows = benchmarkRows
    .filter(
      (row) =>
        Number.isFinite(row.unravelDelta) &&
        row.unravelDelta > IMPROVEMENT_EPSILON,
    )
    .sort((left, right) => {
      if (right.unravelDelta !== left.unravelDelta) {
        return right.unravelDelta - left.unravelDelta
      }

      return right.unravelVsSectionDelta - left.unravelVsSectionDelta
    })
    .slice(0, 10)
    .map((row) => ({
      sample: row.sample,
      circuit: row.circuit,
      baselineMaxRegionCost: round(row.baselineMaxRegionCost),
      sectionFinalMaxRegionCost: round(row.sectionFinalMaxRegionCost),
      unravelFinalMaxRegionCost: round(row.unravelFinalMaxRegionCost),
      unravelDelta: round(row.unravelDelta),
      unravelVsSectionDelta: round(row.unravelVsSectionDelta),
      betterThanSection: row.betterThanSection,
      mutationDepth: row.mutationDepth,
    }))

  return {
    config,
    rows: benchmarkRows,
    topUnravelRows,
    summary: {
      samples: benchmarkRows.length,
      improvedVsBaselineCount,
      betterThanSectionCount,
      matchedSectionCount,
      regressedVsSectionCount,
      failedSampleCount,
      totalSectionDelta: round(totalSectionDelta, 4),
      totalUnravelDelta: round(totalUnravelDelta, 4),
      totalUnravelVsSectionDelta: round(totalUnravelVsSectionDelta, 4),
      avgSectionDelta: round(totalSectionDelta / solvedSampleCount, 5),
      avgUnravelDelta: round(totalUnravelDelta / solvedSampleCount, 5),
      avgUnravelVsSectionDelta: round(
        totalUnravelVsSectionDelta / solvedSampleCount,
        5,
      ),
      elapsedMs: round(benchmarkElapsedMs, 2),
      totalSolveGraphMs: round(totalSolveGraphMs, 2),
      totalSectionPipelineMs: round(totalSectionPipelineMs, 2),
      totalUnravelSearchMs: round(totalUnravelSearchMs, 2),
      totalUnravelTotalMs: round(totalUnravelTotalMs, 2),
      averageMutationDepth: round(totalMutationDepth / solvedSampleCount, 2),
      averageStatesExpanded: round(totalStatesExpanded / solvedSampleCount, 2),
    },
  }
}
