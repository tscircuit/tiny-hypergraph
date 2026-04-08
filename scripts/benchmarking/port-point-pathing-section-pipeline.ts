import { existsSync, readFileSync } from "node:fs"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionCandidateFamily,
  type TinyHyperGraphSolver,
} from "../../lib/index"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"

const DEFAULT_INPUT_PATH =
  process.env.TINY_HYPERGRAPH_PORT_POINT_PATHING_INPUT ??
  "/Users/seve/Downloads/portPointPathingSolver_input (6).json"

const DEFAULT_CANDIDATE_FAMILIES: TinyHyperGraphSectionCandidateFamily[] = [
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]

const parseStringArg = (flag: string) => {
  const argIndex = process.argv.findIndex((arg) => arg === flag)
  return argIndex === -1 ? undefined : process.argv[argIndex + 1]
}

const parsePositiveIntegerArg = (flag: string, fallback: number) => {
  const rawValue = parseStringArg(flag)
  if (!rawValue) {
    return fallback
  }

  const parsedValue = Number(rawValue)
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid ${flag} value: ${rawValue}`)
  }

  return parsedValue
}

const formatMs = (value: number) => `${value.toFixed(1)}ms`

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) => {
  const { topology, problem, solution } =
    loadSerializedHyperGraph(serializedHyperGraph)
  const replaySolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  return getMaxRegionCost(replaySolver.baselineSolver)
}

type BenchmarkCase = {
  label: string
  maxHotRegions?: number
  candidateFamilies?: TinyHyperGraphSectionCandidateFamily[]
}

type BenchmarkRow = {
  label: string
  avgPipelineMs: number
  avgSectionSearchMs: number
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  scoreDelta: number
  avgCandidateCount: number
  selectedSectionCandidateLabel?: string
  selectedSectionCandidateFamily?: string
}

const runBenchmarkCase = (
  serializedHyperGraph: SerializedHyperGraph,
  benchmarkCase: BenchmarkCase,
  repeatCount: number,
): BenchmarkRow => {
  let totalPipelineMs = 0
  let totalSectionSearchMs = 0
  let totalCandidateCount = 0
  let baselineMaxRegionCost = 0
  let finalMaxRegionCost = 0
  let selectedSectionCandidateLabel: string | undefined
  let selectedSectionCandidateFamily: string | undefined

  for (let runIndex = 0; runIndex < repeatCount; runIndex++) {
    const pipelineStartTime = performance.now()
    const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph,
      sectionSearchConfig:
        benchmarkCase.maxHotRegions !== undefined ||
        benchmarkCase.candidateFamilies !== undefined
          ? {
              maxHotRegions: benchmarkCase.maxHotRegions,
              candidateFamilies: benchmarkCase.candidateFamilies,
            }
          : undefined,
    })

    pipelineSolver.solve()

    if (pipelineSolver.failed) {
      throw new Error(
        pipelineSolver.error ?? `${benchmarkCase.label} failed unexpectedly`,
      )
    }

    totalPipelineMs += performance.now() - pipelineStartTime
    totalSectionSearchMs += Number(pipelineSolver.stats.sectionSearchMs ?? 0)
    totalCandidateCount += Number(
      pipelineSolver.stats.sectionSearchCandidateCount ?? 0,
    )
    const solveGraphOutput =
      pipelineSolver.getStageOutput<SerializedHyperGraph>("solveGraph")
    const finalOutput = pipelineSolver.getOutput()

    if (!solveGraphOutput || !finalOutput) {
      throw new Error(`${benchmarkCase.label} did not produce pipeline output`)
    }

    baselineMaxRegionCost = getSerializedOutputMaxRegionCost(solveGraphOutput)
    finalMaxRegionCost = getSerializedOutputMaxRegionCost(finalOutput)
    selectedSectionCandidateLabel = pipelineSolver.selectedSectionCandidateLabel
    selectedSectionCandidateFamily =
      pipelineSolver.selectedSectionCandidateFamily
  }

  return {
    label: benchmarkCase.label,
    avgPipelineMs: totalPipelineMs / repeatCount,
    avgSectionSearchMs: totalSectionSearchMs / repeatCount,
    baselineMaxRegionCost,
    finalMaxRegionCost,
    scoreDelta: baselineMaxRegionCost - finalMaxRegionCost,
    avgCandidateCount: totalCandidateCount / repeatCount,
    selectedSectionCandidateLabel,
    selectedSectionCandidateFamily,
  }
}

const inputPath = parseStringArg("--input") ?? DEFAULT_INPUT_PATH
const repeatCount = parsePositiveIntegerArg("--repeat", 1)

if (!existsSync(inputPath)) {
  throw new Error(
    `Input file not found at ${inputPath}. Pass --input or set TINY_HYPERGRAPH_PORT_POINT_PATHING_INPUT.`,
  )
}

const input = JSON.parse(readFileSync(inputPath, "utf8"))
const serializedHyperGraph =
  convertPortPointPathingSolverInputToSerializedHyperGraph(input)

const benchmarkCases: BenchmarkCase[] = [
  {
    label: "legacy-default-9",
    maxHotRegions: 9,
    candidateFamilies: DEFAULT_CANDIDATE_FAMILIES,
  },
  {
    label: "tuned-default-2",
    maxHotRegions: 2,
    candidateFamilies: DEFAULT_CANDIDATE_FAMILIES,
  },
  {
    label: "current-default",
  },
]

console.log(
  `benchmarking port-point-pathing section pipeline input=${inputPath} repeatCount=${repeatCount}`,
)

const rows = benchmarkCases.map((benchmarkCase) =>
  runBenchmarkCase(serializedHyperGraph, benchmarkCase, repeatCount),
)
const legacyRow = rows[0]

console.table(
  rows.map((row) => ({
    label: row.label,
    avgPipeline: formatMs(row.avgPipelineMs),
    avgSectionSearch: formatMs(row.avgSectionSearchMs),
    speedupVsLegacy:
      legacyRow && row !== legacyRow
        ? `${(legacyRow.avgPipelineMs / row.avgPipelineMs).toFixed(2)}x`
        : "1.00x",
    baselineMaxRegionCost: row.baselineMaxRegionCost.toFixed(12),
    finalMaxRegionCost: row.finalMaxRegionCost.toFixed(12),
    scoreDelta: row.scoreDelta.toFixed(12),
    scoreDriftVsLegacy:
      legacyRow && row !== legacyRow
        ? (row.finalMaxRegionCost - legacyRow.finalMaxRegionCost).toFixed(12)
        : "0.000000000000",
    avgCandidateCount: row.avgCandidateCount.toFixed(1),
    selectedCandidate: row.selectedSectionCandidateLabel ?? null,
    family: row.selectedSectionCandidateFamily ?? null,
  })),
)
