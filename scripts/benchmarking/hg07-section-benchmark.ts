import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  DEFAULT_NON_CENTER_COST_PER_MM,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
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

export type CandidateFamily =
  | "self-all"
  | "self-touch"
  | "onehop-all"
  | "onehop-touch"
  | "twohop-all"
  | "twohop-touch"

type SectionMaskCandidate = {
  label: string
  family: CandidateFamily
  regionIds: number[]
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected"
}

type SectionPassResult = {
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  delta: number
  activeRouteCount: number
  outputGraph: SerializedHyperGraph
  winningCandidateLabel?: string
  winningCandidateFamily?: CandidateFamily
}

export type BenchmarkRow = {
  sample: string
  circuit: string
  passesUsed: number
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  delta: number
  activeRouteCount: number
  winningCandidateLabel?: string
  winningCandidateFamily?: CandidateFamily
  failed?: boolean
  error?: string
}

type FamilyTimingSummary = {
  family: CandidateFamily
  attempts: number
  wins: number
  totalInitMs: number
  totalSolveMs: number
  totalMs: number
  averageInitMs: number
  averageSolveMs: number
  averageMs: number
  averageActiveRouteCount: number
  averageRipsUsed: number
}

export type SectionSolverBenchmarkConfig = {
  sampleCount: number
  maxPasses: number
  maxHotRegions: number
  candidateFamilies: CandidateFamily[]
  improvementEpsilon: number
  sectionSolver: {
    distanceToCost: number
    nonCenterCostPerMm: number
    ripThresholdStart: number
    ripThresholdEnd: number
    ripThresholdRampAttempts: number
    maxRips: number
    maxRipsWithoutMaxRegionCostImprovement: number
    extraRipsAfterBeatingBaselineMaxRegionCost: number
    ripCongestionRegionCostFactor: number
    maxIterations: number
  }
}

export type SectionSolverBenchmarkSummary = {
  samples: number
  improvedSampleCount: number
  unchangedSampleCount: number
  failedSampleCount: number
  totalDelta: number
  avgMaxRegionDelta: number
  averagePassesUsed: number
  elapsedMs: number
  totalSolveGraphMs: number
  totalReplayLoadMs: number
  totalCandidateInitMs: number
  totalCandidateSolveMs: number
  totalCandidateCount: number
  candidateFamilies: FamilyTimingSummary[]
}

export type SectionSolverBenchmarkResult = {
  config: SectionSolverBenchmarkConfig
  rows: BenchmarkRow[]
  topImprovedRows: Array<{
    sample: string
    circuit: string
    delta: number
    baselineMaxRegionCost: number
    finalMaxRegionCost: number
    activeRouteCount: number
    winningCandidateLabel?: string | null
    winningCandidateFamily?: CandidateFamily | null
  }>
  summary: SectionSolverBenchmarkSummary
}

export type SectionSolverBenchmarkProgress = {
  row: BenchmarkRow
  completedSamples: number
  totalSamples: number
  progressPct: number
  successPct: number
  improvedSampleCount: number
  unchangedSampleCount: number
  failedSampleCount: number
  elapsedMs: number
}

type SectionSolverBenchmarkOptions = {
  onProgress?: (progress: SectionSolverBenchmarkProgress) => void
}

const datasetModule = datasetHg07 as DatasetModule

const allCandidateFamilies: CandidateFamily[] = [
  "self-all",
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]

export const legacySectionSolverBenchmarkConfig: SectionSolverBenchmarkConfig = {
  sampleCount: 40,
  maxPasses: 2,
  maxHotRegions: 12,
  candidateFamilies: allCandidateFamilies,
  improvementEpsilon: 1e-9,
  sectionSolver: {
    distanceToCost: 0.05,
    nonCenterCostPerMm: DEFAULT_NON_CENTER_COST_PER_MM,
    ripThresholdStart: 0.05,
    ripThresholdEnd: 0.8,
    ripThresholdRampAttempts: 50,
    maxRips: Number.POSITIVE_INFINITY,
    maxRipsWithoutMaxRegionCostImprovement: Number.POSITIVE_INFINITY,
    extraRipsAfterBeatingBaselineMaxRegionCost: Number.POSITIVE_INFINITY,
    ripCongestionRegionCostFactor: 0.1,
    maxIterations: 1e6,
  },
}

const defaultCandidateFamilies: CandidateFamily[] = [
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]

export const defaultSectionSolverBenchmarkConfig: SectionSolverBenchmarkConfig =
  {
    ...legacySectionSolverBenchmarkConfig,
    maxPasses: 1,
    maxHotRegions: 9,
    candidateFamilies: defaultCandidateFamilies,
  }

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: number[],
) => {
  const adjacentRegionIds = new Set(seedRegionIds)

  for (const seedRegionId of seedRegionIds) {
    for (const portId of topology.regionIncidentPorts[seedRegionId] ?? []) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(regionId)
      }
    }
  }

  return [...adjacentRegionIds]
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: number[],
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (portSelectionRule === "touches-selected-region") {
      return incidentRegionIds.some((regionId) => selectedRegionIds.has(regionId))
        ? 1
        : 0
    }

    return incidentRegionIds.length > 0 &&
      incidentRegionIds.every((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const createProblemWithPortSectionMask = (
  problem: TinyHyperGraphProblem,
  portSectionMask: Int8Array,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask,
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
})

const getSectionMaskCandidates = (
  solver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  config: SectionSolverBenchmarkConfig,
): SectionMaskCandidate[] => {
  const hotRegionIds = solver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, config.maxHotRegions)
    .map(({ regionId }) => regionId)

  const candidates: SectionMaskCandidate[] = []

  for (const hotRegionId of hotRegionIds) {
    const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])
    const twoHopRegionIds = getAdjacentRegionIds(topology, oneHopRegionIds)

    const candidateByFamily: Record<CandidateFamily, SectionMaskCandidate> = {
      "self-all": {
        label: `hot-${hotRegionId}-self-all`,
        family: "self-all",
        regionIds: [hotRegionId],
        portSelectionRule: "all-incident-regions-selected",
      },
      "self-touch": {
        label: `hot-${hotRegionId}-self-touch`,
        family: "self-touch",
        regionIds: [hotRegionId],
        portSelectionRule: "touches-selected-region",
      },
      "onehop-all": {
        label: `hot-${hotRegionId}-onehop-all`,
        family: "onehop-all",
        regionIds: oneHopRegionIds,
        portSelectionRule: "all-incident-regions-selected",
      },
      "onehop-touch": {
        label: `hot-${hotRegionId}-onehop-touch`,
        family: "onehop-touch",
        regionIds: oneHopRegionIds,
        portSelectionRule: "touches-selected-region",
      },
      "twohop-all": {
        label: `hot-${hotRegionId}-twohop-all`,
        family: "twohop-all",
        regionIds: twoHopRegionIds,
        portSelectionRule: "all-incident-regions-selected",
      },
      "twohop-touch": {
        label: `hot-${hotRegionId}-twohop-touch`,
        family: "twohop-touch",
        regionIds: twoHopRegionIds,
        portSelectionRule: "touches-selected-region",
      },
    }

    for (const family of config.candidateFamilies) {
      candidates.push(candidateByFamily[family])
    }
  }

  return candidates
}

type MutableFamilyTiming = {
  attempts: number
  wins: number
  totalInitMs: number
  totalSolveMs: number
  totalMs: number
  totalActiveRouteCount: number
  totalRipsUsed: number
}

type MutableProfilingState = {
  totalSolveGraphMs: number
  totalReplayLoadMs: number
  totalCandidateInitMs: number
  totalCandidateSolveMs: number
  totalCandidateCount: number
  familyTimings: Record<CandidateFamily, MutableFamilyTiming>
}

const createProfilingState = (): MutableProfilingState => ({
  totalSolveGraphMs: 0,
  totalReplayLoadMs: 0,
  totalCandidateInitMs: 0,
  totalCandidateSolveMs: 0,
  totalCandidateCount: 0,
  familyTimings: {
    "self-all": {
      attempts: 0,
      wins: 0,
      totalInitMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      totalActiveRouteCount: 0,
      totalRipsUsed: 0,
    },
    "self-touch": {
      attempts: 0,
      wins: 0,
      totalInitMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      totalActiveRouteCount: 0,
      totalRipsUsed: 0,
    },
    "onehop-all": {
      attempts: 0,
      wins: 0,
      totalInitMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      totalActiveRouteCount: 0,
      totalRipsUsed: 0,
    },
    "onehop-touch": {
      attempts: 0,
      wins: 0,
      totalInitMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      totalActiveRouteCount: 0,
      totalRipsUsed: 0,
    },
    "twohop-all": {
      attempts: 0,
      wins: 0,
      totalInitMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      totalActiveRouteCount: 0,
      totalRipsUsed: 0,
    },
    "twohop-touch": {
      attempts: 0,
      wins: 0,
      totalInitMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      totalActiveRouteCount: 0,
      totalRipsUsed: 0,
    },
  },
})

const applySectionSolverConfig = (
  sectionSolver: TinyHyperGraphSectionSolver,
  config: SectionSolverBenchmarkConfig,
) => {
  sectionSolver.DISTANCE_TO_COST = config.sectionSolver.distanceToCost
  sectionSolver.NON_CENTER_COST_PER_MM =
    config.sectionSolver.nonCenterCostPerMm
  sectionSolver.RIP_THRESHOLD_START = config.sectionSolver.ripThresholdStart
  sectionSolver.RIP_THRESHOLD_END = config.sectionSolver.ripThresholdEnd
  sectionSolver.RIP_THRESHOLD_RAMP_ATTEMPTS =
    config.sectionSolver.ripThresholdRampAttempts
  sectionSolver.MAX_RIPS = config.sectionSolver.maxRips
  sectionSolver.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT =
    config.sectionSolver.maxRipsWithoutMaxRegionCostImprovement
  sectionSolver.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST =
    config.sectionSolver.extraRipsAfterBeatingBaselineMaxRegionCost
  sectionSolver.RIP_CONGESTION_REGION_COST_FACTOR =
    config.sectionSolver.ripCongestionRegionCostFactor
  sectionSolver.MAX_ITERATIONS = config.sectionSolver.maxIterations
}

const runBestSectionOptimizationPass = (
  serializedHyperGraph: SerializedHyperGraph,
  config: SectionSolverBenchmarkConfig,
  profiling: MutableProfilingState,
): SectionPassResult => {
  const solveGraphStartTime = performance.now()
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solveGraphSolver = new TinyHyperGraphSolver(topology, problem, {
    NON_CENTER_COST_PER_MM: config.sectionSolver.nonCenterCostPerMm,
  })
  solveGraphSolver.solve()
  profiling.totalSolveGraphMs += performance.now() - solveGraphStartTime

  const replayLoadStartTime = performance.now()
  const solvedGraph = solveGraphSolver.getOutput()
  const replay = loadSerializedHyperGraph(solvedGraph)
  profiling.totalReplayLoadMs += performance.now() - replayLoadStartTime

  const baselineSectionSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )
  const baselineMaxRegionCost = getMaxRegionCost(baselineSectionSolver.baselineSolver)

  let bestFinalMaxRegionCost = baselineMaxRegionCost
  let bestSolver: TinyHyperGraphSectionSolver | undefined
  let winningCandidateLabel: string | undefined
  let winningCandidateFamily: CandidateFamily | undefined

  for (const candidate of getSectionMaskCandidates(
    solveGraphSolver,
    replay.topology,
    config,
  )) {
    const familyTiming = profiling.familyTimings[candidate.family]

    try {
      const initStartTime = performance.now()
      const sectionSolver = new TinyHyperGraphSectionSolver(
        replay.topology,
        createProblemWithPortSectionMask(
          replay.problem,
          createPortSectionMaskForRegionIds(
            replay.topology,
            candidate.regionIds,
            candidate.portSelectionRule,
          ),
        ),
        replay.solution,
      )
      applySectionSolverConfig(sectionSolver, config)
      const initElapsedMs = performance.now() - initStartTime

      const solveStartTime = performance.now()
      sectionSolver.solve()
      const solveElapsedMs = performance.now() - solveStartTime
      const totalElapsedMs = initElapsedMs + solveElapsedMs
      const ripsUsed = sectionSolver.sectionSolver?.state.ripCount ?? 0
      const activeRouteCount = sectionSolver.activeRouteIds.length

      familyTiming.attempts += 1
      familyTiming.totalInitMs += initElapsedMs
      familyTiming.totalSolveMs += solveElapsedMs
      familyTiming.totalMs += totalElapsedMs
      familyTiming.totalActiveRouteCount += activeRouteCount
      familyTiming.totalRipsUsed += ripsUsed

      profiling.totalCandidateCount += 1
      profiling.totalCandidateInitMs += initElapsedMs
      profiling.totalCandidateSolveMs += solveElapsedMs

      const finalMaxRegionCost = getMaxRegionCost(sectionSolver.getSolvedSolver())

      if (
        finalMaxRegionCost <
        bestFinalMaxRegionCost - config.improvementEpsilon
      ) {
        bestFinalMaxRegionCost = finalMaxRegionCost
        bestSolver = sectionSolver
        winningCandidateLabel = candidate.label
        winningCandidateFamily = candidate.family
      }
    } catch {
      // Skip invalid section masks that cannot produce a valid single section span.
    }
  }

  if (winningCandidateFamily) {
    profiling.familyTimings[winningCandidateFamily].wins += 1
  }

  return {
    baselineMaxRegionCost,
    finalMaxRegionCost: bestFinalMaxRegionCost,
    delta: baselineMaxRegionCost - bestFinalMaxRegionCost,
    activeRouteCount: bestSolver?.activeRouteIds.length ?? 0,
    outputGraph: bestSolver ? bestSolver.getOutput() : solvedGraph,
    winningCandidateLabel,
    winningCandidateFamily,
  }
}

const round = (value: number, digits = 3) =>
  Number(value.toFixed(digits))

export const runSectionSolverBenchmark = (
  inputConfig: Partial<SectionSolverBenchmarkConfig> = {},
  options: SectionSolverBenchmarkOptions = {},
): SectionSolverBenchmarkResult => {
  const config: SectionSolverBenchmarkConfig = {
    ...defaultSectionSolverBenchmarkConfig,
    ...inputConfig,
    sectionSolver: {
      ...defaultSectionSolverBenchmarkConfig.sectionSolver,
      ...inputConfig.sectionSolver,
    },
    candidateFamilies:
      inputConfig.candidateFamilies ??
      defaultSectionSolverBenchmarkConfig.candidateFamilies,
  }

  const sampleMetas = datasetModule.manifest.samples.slice(0, config.sampleCount)
  const benchmarkRows: BenchmarkRow[] = []
  let improvedSampleCount = 0
  let unchangedSampleCount = 0
  let failedSampleCount = 0
  let totalDelta = 0
  let totalPassesUsed = 0
  const profiling = createProfilingState()
  const benchmarkStartTime = performance.now()

  for (const sampleMeta of sampleMetas) {
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      let currentGraph = serializedHyperGraph
      let baselineMaxRegionCost = 0
      let finalMaxRegionCost = 0
      let activeRouteCount = 0
      let winningCandidateLabel: string | undefined
      let winningCandidateFamily: CandidateFamily | undefined
      let passesUsed = 0

      for (let passIndex = 0; passIndex < config.maxPasses; passIndex++) {
        const passResult = runBestSectionOptimizationPass(
          currentGraph,
          config,
          profiling,
        )

        if (passIndex === 0) {
          baselineMaxRegionCost = passResult.baselineMaxRegionCost
        }

        finalMaxRegionCost = passResult.finalMaxRegionCost
        activeRouteCount = passResult.activeRouteCount
        winningCandidateLabel = passResult.winningCandidateLabel
        winningCandidateFamily = passResult.winningCandidateFamily
        passesUsed = passIndex + 1

        if (passResult.delta <= config.improvementEpsilon) {
          break
        }

        currentGraph = passResult.outputGraph
      }

      const delta = baselineMaxRegionCost - finalMaxRegionCost
      totalDelta += delta
      totalPassesUsed += passesUsed

      if (delta > config.improvementEpsilon) {
        improvedSampleCount += 1
      } else {
        unchangedSampleCount += 1
      }

      benchmarkRows.push({
        sample: sampleMeta.sampleName,
        circuit: sampleMeta.circuitId,
        passesUsed,
        baselineMaxRegionCost,
        finalMaxRegionCost,
        delta,
        activeRouteCount,
        winningCandidateLabel,
        winningCandidateFamily,
      })
      options.onProgress?.({
        row: benchmarkRows[benchmarkRows.length - 1]!,
        completedSamples: benchmarkRows.length,
        totalSamples: sampleMetas.length,
        progressPct: (benchmarkRows.length / Math.max(sampleMetas.length, 1)) * 100,
        successPct:
          (improvedSampleCount /
            Math.max(benchmarkRows.length - failedSampleCount, 1)) *
          100,
        improvedSampleCount,
        unchangedSampleCount,
        failedSampleCount,
        elapsedMs: performance.now() - benchmarkStartTime,
      })
    } catch (error) {
      failedSampleCount += 1
      benchmarkRows.push({
        sample: sampleMeta.sampleName,
        circuit: sampleMeta.circuitId,
        passesUsed: 0,
        baselineMaxRegionCost: Number.NaN,
        finalMaxRegionCost: Number.NaN,
        delta: Number.NaN,
        activeRouteCount: 0,
        failed: true,
        error: String(error),
      })
      options.onProgress?.({
        row: benchmarkRows[benchmarkRows.length - 1]!,
        completedSamples: benchmarkRows.length,
        totalSamples: sampleMetas.length,
        progressPct: (benchmarkRows.length / Math.max(sampleMetas.length, 1)) * 100,
        successPct:
          (improvedSampleCount /
            Math.max(benchmarkRows.length - failedSampleCount, 1)) *
          100,
        improvedSampleCount,
        unchangedSampleCount,
        failedSampleCount,
        elapsedMs: performance.now() - benchmarkStartTime,
      })
    }
  }

  const benchmarkElapsedMs = performance.now() - benchmarkStartTime
  const solvedSampleCount = Math.max(
    benchmarkRows.length - failedSampleCount,
    1,
  )

  const topImprovedRows = benchmarkRows
    .filter(
      (row) => Number.isFinite(row.delta) && row.delta > config.improvementEpsilon,
    )
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 10)
    .map((row) => ({
      sample: row.sample,
      circuit: row.circuit,
      delta: round(row.delta),
      baselineMaxRegionCost: round(row.baselineMaxRegionCost),
      finalMaxRegionCost: round(row.finalMaxRegionCost),
      activeRouteCount: row.activeRouteCount,
      winningCandidateLabel: row.winningCandidateLabel ?? null,
      winningCandidateFamily: row.winningCandidateFamily ?? null,
    }))

  const familySummaries = config.candidateFamilies.map((family) => {
    const timing = profiling.familyTimings[family]

    return {
      family,
      attempts: timing.attempts,
      wins: timing.wins,
      totalInitMs: round(timing.totalInitMs, 2),
      totalSolveMs: round(timing.totalSolveMs, 2),
      totalMs: round(timing.totalMs, 2),
      averageInitMs:
        timing.attempts > 0 ? round(timing.totalInitMs / timing.attempts, 2) : 0,
      averageSolveMs:
        timing.attempts > 0
          ? round(timing.totalSolveMs / timing.attempts, 2)
          : 0,
      averageMs:
        timing.attempts > 0 ? round(timing.totalMs / timing.attempts, 2) : 0,
      averageActiveRouteCount:
        timing.attempts > 0
          ? round(timing.totalActiveRouteCount / timing.attempts, 2)
          : 0,
      averageRipsUsed:
        timing.attempts > 0
          ? round(timing.totalRipsUsed / timing.attempts, 2)
          : 0,
    }
  })

  return {
    config,
    rows: benchmarkRows,
    topImprovedRows,
    summary: {
      samples: benchmarkRows.length,
      improvedSampleCount,
      unchangedSampleCount,
      failedSampleCount,
      totalDelta: round(totalDelta, 4),
      avgMaxRegionDelta: round(totalDelta / solvedSampleCount, 5),
      averagePassesUsed: round(totalPassesUsed / solvedSampleCount, 2),
      elapsedMs: round(benchmarkElapsedMs, 2),
      totalSolveGraphMs: round(profiling.totalSolveGraphMs, 2),
      totalReplayLoadMs: round(profiling.totalReplayLoadMs, 2),
      totalCandidateInitMs: round(profiling.totalCandidateInitMs, 2),
      totalCandidateSolveMs: round(profiling.totalCandidateSolveMs, 2),
      totalCandidateCount: profiling.totalCandidateCount,
      candidateFamilies: familySummaries,
    },
  }
}

export const formatBenchmarkRows = (rows: BenchmarkRow[]) =>
  rows.map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    passesUsed: row.passesUsed,
    baselineMaxRegionCost: Number.isFinite(row.baselineMaxRegionCost)
      ? round(row.baselineMaxRegionCost)
      : null,
    finalMaxRegionCost: Number.isFinite(row.finalMaxRegionCost)
      ? round(row.finalMaxRegionCost)
      : null,
    delta: Number.isFinite(row.delta) ? round(row.delta) : null,
    activeRouteCount: row.activeRouteCount,
    winningCandidateLabel: row.winningCandidateLabel ?? null,
    winningCandidateFamily: row.winningCandidateFamily ?? null,
    failed: row.failed ?? false,
    error: row.error ?? null,
  }))
