import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getPngBufferFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { createHash } from "node:crypto"
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { availableParallelism } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { applyInitialAssignments } from "../../lib/initialAssignments"
import {
  ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  PolyHyperGraphSectionPipelineSolver,
  SelectiveReripTinyHyperGraphSolver,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionCandidateFamily,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSolver,
  loadSerializedHyperGraphAsPoly,
} from "../../lib/index"

type DatasetModule = Record<string, unknown> & {
  manifest: {
    sampleCount: number
    samples: DatasetSampleMeta[]
  }
}

type DatasetSampleMeta = {
  sampleName: string
  circuitKey: string
  circuitId: string
  stepsToPortPointSolve: number
}

type Srj18CaseSource = {
  dataset: "srj18"
  datasetCommit: string
  autorouterRepo: string
  autorouterVersion: string
  autorouterCommit: string
  autorouterTree: string
  benchmarkRunId: string
  benchmarkEffort: number
  completionTimeMs: number
  viaCount: number
  relaxedDrcPassed: boolean
}

type Srj18BenchmarkCase = {
  version: 1
  sampleName: string
  source: Srj18CaseSource
  solverInput: {
    serializedHyperGraph: SerializedHyperGraph
    solveGraphOptions: NonNullable<
      TinyHyperGraphSectionPipelineInput["solveGraphOptions"]
    >
    sectionSolverOptions: NonNullable<
      TinyHyperGraphSectionPipelineInput["sectionSolverOptions"]
    >
    pipelineMaxIterations: number
    sectionMaskStrategy: "all-zero"
    solveGraphSolver: "selective-rerip-stable-initial-assignments"
  }
}

type Srj18Manifest = {
  version: 1
  name: string
  sampleCount: number
  source: {
    datasetCommit: string
    autorouterCommit: string
    benchmarkRunId: string
  }
  cases: Array<{
    sampleName: string
    fileName: string
    sha256: string
  }>
}

type LoadedDataset = {
  datasetModule: DatasetModule
  srj18Cases: Map<string, Srj18BenchmarkCase>
  datasetSource: string
  datasetRevision: string | null
  sampleSelection: string
}

type BenchmarkSampleResult = {
  sampleName: string
  circuitId: string
  status: "success" | "failed"
  durationMs: number
  iterations: number
  connectionCount: number
  solvedRouteCount: number
  routeCompletionRate: string
  avgRouteHops: number | null
  requiredRipRouteCount: number
  baselineMaxRegionCost: number | null
  finalMaxRegionCost: number | null
  delta: number | null
  optimized: boolean
  zeroFinalCost: boolean
  candidateCount: number
  generatedCandidateCount: number
  duplicateCandidateCount: number
  solveGraphMs: number
  sectionSearchMs: number
  optimizeSectionMs: number
  optimizeRegionCostsMs: number
  selectedCandidateLabel: string | null
  selectedCandidateFamily: string | null
  error: string | null
  logsPath: string | null
  snapshotPath: string | null
  referenceCompletionTimeMs: number | null
  referenceViaCount: number | null
  referenceRelaxedDrcPassed: boolean | null
}

type BenchmarkReport = {
  version: 1
  datasetName: DatasetKey
  datasetSource: string
  datasetRevision: string | null
  sampleSelection: string
  solverVariant: SolverVariant
  candidateFamilies: string
  concurrency: number
  sampleCount: number
  successCount: number
  failedCount: number
  improvedCount: number
  zeroFinalCostCount: number
  summary: {
    successRate: string
    routeCompletionRate: string
    improvedRate: string
    zeroFinalCostRate: string
    totalDurationMs: number
    avgBaselineMaxRegionCost: number
    avgFinalMaxRegionCost: number
    avgMaxRegionDelta: number
    p50BaselineMaxRegionCost: number
    p50FinalMaxRegionCost: number
    p50MaxRegionCostReductionRate: string
    p95BaselineMaxRegionCost: number
    p95FinalMaxRegionCost: number
    p95MaxRegionCostReductionRate: string
    regionCostReductionTargetMet: boolean
    avgCandidateCount: number
    avgGeneratedCandidateCount: number
    avgDuplicateCandidateCount: number
    avgIterations: number
    avgRouteHops: number
    totalRequiredRipRouteCount: number
    avgSolveGraphMs: number
    avgSectionSearchMs: number
    avgOptimizeSectionMs: number
    avgOptimizeRegionCostsMs: number
    avgDurationMs: number
    p50DurationMs: number
    p95DurationMs: number
  }
  samples: BenchmarkSampleResult[]
}

type SolverVariant = "core" | "poly"
type DatasetKey = "hg07" | "srj18"

const IMPROVEMENT_EPSILON = 1e-9
const REGION_COST_REDUCTION_TARGET = 0.5

const HELP_TEXT = `Usage: ./benchmark.sh [options]

Run the section-pipeline benchmark and write per-sample artifacts under ./results/runNNN/.

Options:
  --dataset NAME  Dataset to run: hg07 or 18/srj18. ./benchmark.sh defaults to srj18.
  --limit N       Run the first N samples from the dataset.
  --sample NUM    Run a specific sample by number or name (e.g. 2, 002, sample002).
  --solver NAME   Solver variant: core or poly. SRJ18 uses Pipeline7's core solver.
  --concurrency N Benchmark concurrency value, or "auto". Defaults to BENCHMARK_CONCURRENCY or CPU count.
  --families LIST Override hg07 candidate families. Use a preset (default, default+deep, all)
                  or a comma-separated list such as self-touch,onehop-all,twohop-touch.
  --help          Show this help text.

Examples:
  ./benchmark.sh                         # committed completed Pipeline7 SRJ18 cases
  ./benchmark.sh --dataset hg07
  ./benchmark.sh --dataset 18
  ./benchmark.sh --limit 4
  ./benchmark.sh --limit 4 --concurrency 4
  ./benchmark.sh --dataset hg07 --limit 20 --solver poly
  ./benchmark.sh --sample 3
  ./benchmark.sh --sample sample003
  ./benchmark.sh --dataset hg07 --limit 40 --families default+deep

Outputs:
  - Incremental progress lines always include duration=... for hillclimbing workflows.
  - Failed samples write ./results/runNNN/sampleXXX/logs.txt
  - Failed samples also write ./results/runNNN/sampleXXX/snapshot.png

Summary metrics:
  - success rate
  - solved-route completion rate
  - improved rate
  - zero-final-max-region-cost rate
  - total / avg / P50 / P95 completion time and per-stage timing
  - avg/P50/P95 baseline and final max region cost, including reduction rates
  - iterations, route hops/rips, and generated/attempted/duplicate candidates
`

const usageError = (message: string): never => {
  console.error(message)
  console.error("")
  console.error(HELP_TEXT)
  process.exit(1)
}

const formatSampleName = (value: string): string => {
  if (/^sample\d+$/i.test(value)) {
    const digits = value.replace(/^sample/i, "")
    return `sample${digits.padStart(3, "0")}`
  }

  if (/^\d+$/.test(value)) {
    return `sample${value.padStart(3, "0")}`
  }

  return usageError(`Invalid --sample value: ${value}`)
}

const CANDIDATE_FAMILY_PRESETS: Record<
  string,
  TinyHyperGraphSectionCandidateFamily[]
> = {
  default: [...DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES],
  "default+deep": [
    ...DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
    ...OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  ],
  all: [...ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES],
}

const ALL_SUPPORTED_CANDIDATE_FAMILIES = new Set(
  ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
)

const parseCandidateFamilies = (
  rawValue: string,
): TinyHyperGraphSectionCandidateFamily[] => {
  const preset = CANDIDATE_FAMILY_PRESETS[rawValue]

  if (preset) {
    return [...preset]
  }

  const candidateFamilies = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (candidateFamilies.length === 0) {
    usageError("Missing value for --families")
  }

  const invalidFamilies = candidateFamilies.filter(
    (family) =>
      !ALL_SUPPORTED_CANDIDATE_FAMILIES.has(
        family as TinyHyperGraphSectionCandidateFamily,
      ),
  )

  if (invalidFamilies.length > 0) {
    usageError(`Invalid --families value: ${invalidFamilies.join(", ")}`)
  }

  return candidateFamilies as TinyHyperGraphSectionCandidateFamily[]
}

const parseArgs = () => {
  let limit: number | null = null
  let sampleName: string | null = null
  let candidateFamilies: TinyHyperGraphSectionCandidateFamily[] | null = null
  let solverVariant: SolverVariant = "core"
  let datasetKey: DatasetKey = "hg07"
  let concurrency = getDefaultConcurrency()

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index]

    if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT)
      process.exit(0)
    }

    if (arg === "--limit") {
      const rawValue = process.argv[index + 1]
      const parsedValue = Number(rawValue)

      if (!rawValue || !Number.isFinite(parsedValue) || parsedValue <= 0) {
        usageError(`Invalid --limit value: ${rawValue ?? "<missing>"}`)
      }

      limit = Math.floor(parsedValue)
      index += 1
      continue
    }

    if (arg === "--dataset") {
      const rawValue = process.argv[index + 1]
      if (rawValue === "hg07" || rawValue === "7") {
        datasetKey = "hg07"
      } else if (rawValue === "18" || rawValue === "srj18") {
        datasetKey = "srj18"
      } else {
        usageError(`Invalid --dataset value: ${rawValue ?? "<missing>"}`)
      }

      index += 1
      continue
    }

    if (arg === "--concurrency") {
      const rawValue = process.argv[index + 1]
      if (rawValue === "auto") {
        concurrency = getSystemConcurrency()
        index += 1
        continue
      }

      const parsedValue = Number(rawValue)
      if (!rawValue || !Number.isFinite(parsedValue) || parsedValue <= 0) {
        usageError(`Invalid --concurrency value: ${rawValue ?? "<missing>"}`)
      }

      concurrency = Math.floor(parsedValue)
      index += 1
      continue
    }

    if (arg === "--sample") {
      const rawValue = process.argv[index + 1]
      if (!rawValue) {
        usageError("Missing value for --sample")
      }

      sampleName = formatSampleName(rawValue)
      index += 1
      continue
    }

    if (arg === "--families") {
      const rawValue = process.argv[index + 1]
      if (!rawValue) {
        usageError("Missing value for --families")
      }

      candidateFamilies = parseCandidateFamilies(rawValue)
      index += 1
      continue
    }

    if (arg === "--solver") {
      const rawValue = process.argv[index + 1]
      if (rawValue !== "core" && rawValue !== "poly") {
        usageError(`Invalid --solver value: ${rawValue ?? "<missing>"}`)
      }

      solverVariant = rawValue as SolverVariant
      index += 1
      continue
    }

    if (index >= 2 && arg.startsWith("-")) {
      usageError(`Unknown option: ${arg}`)
    }
  }

  if (limit !== null && sampleName !== null) {
    usageError("Use either --limit or --sample, not both")
  }

  return {
    limit,
    sampleName,
    candidateFamilies,
    solverVariant,
    datasetKey,
    concurrency,
  }
}

const getSystemConcurrency = () => {
  try {
    return Math.max(1, availableParallelism())
  } catch {
    return 4
  }
}

const getDefaultConcurrency = () => {
  const rawValue = process.env.BENCHMARK_CONCURRENCY?.trim()

  if (!rawValue || rawValue === "auto") {
    return getSystemConcurrency()
  }

  const parsedValue = Number(rawValue)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.floor(parsedValue)
    : getSystemConcurrency()
}

const formatSeconds = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`

const formatMetric = (value: number | null, digits = 3) =>
  value === null ? "n/a" : value.toFixed(digits)

const formatPercent = (numerator: number, denominator: number) =>
  `${((numerator / Math.max(denominator, 1)) * 100).toFixed(1)}%`

const getReductionRate = (baseline: number, final: number) =>
  baseline <= IMPROVEMENT_EPSILON
    ? final <= IMPROVEMENT_EPSILON
      ? 1
      : 0
    : (baseline - final) / baseline

const formatReductionRate = (baseline: number, final: number) =>
  `${(getReductionRate(baseline, final) * 100).toFixed(1)}%`

const formatDuration = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0

  const sortedValues = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
  )

  return sortedValues[index] ?? 0
}

const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length

const formatMarkdownTableCell = (value: string) =>
  value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")

const truncateTableCell = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`

type TableAlign = "left" | "right"

const renderMarkdownTable = (
  headers: string[],
  rows: string[][],
  alignments: TableAlign[] = [],
) => {
  const columnWidths = headers.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...rows.map((row) => row[columnIndex]?.length ?? 0),
      3,
    ),
  )

  const padCell = (value: string, columnIndex: number) => {
    const width = columnWidths[columnIndex] ?? value.length
    return alignments[columnIndex] === "right"
      ? value.padStart(width)
      : value.padEnd(width)
  }

  const separator = columnWidths.map((width, columnIndex) => {
    if (alignments[columnIndex] === "right") {
      return `${"-".repeat(Math.max(width - 1, 2))}:`
    }

    return "-".repeat(width)
  })

  return [
    `| ${headers.map((header, index) => padCell(header, index)).join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${row.map((cell, index) => padCell(cell, index)).join(" | ")} |`,
    ),
  ]
}

const formatBenchmarkReportText = (report: BenchmarkReport) => {
  const metricRows = [
    ["Success rate", report.summary.successRate],
    ["Solved-route completion rate", report.summary.routeCompletionRate],
    ["Improved rate", report.summary.improvedRate],
    ["Zero final max region cost rate", report.summary.zeroFinalCostRate],
    ["Total completion time", formatDuration(report.summary.totalDurationMs)],
    [
      "Avg baseline max region cost",
      report.summary.avgBaselineMaxRegionCost.toFixed(3),
    ],
    [
      "Avg final max region cost",
      report.summary.avgFinalMaxRegionCost.toFixed(3),
    ],
    ["Avg max region delta", report.summary.avgMaxRegionDelta.toFixed(3)],
    [
      "P50 baseline/final max region cost",
      `${report.summary.p50BaselineMaxRegionCost.toFixed(3)} / ${report.summary.p50FinalMaxRegionCost.toFixed(3)}`,
    ],
    [
      "P50 max region cost reduction",
      report.summary.p50MaxRegionCostReductionRate,
    ],
    [
      "P95 baseline/final max region cost",
      `${report.summary.p95BaselineMaxRegionCost.toFixed(3)} / ${report.summary.p95FinalMaxRegionCost.toFixed(3)}`,
    ],
    [
      "P95 max region cost reduction",
      report.summary.p95MaxRegionCostReductionRate,
    ],
    [
      "P50/P95 50% region cost target",
      report.summary.regionCostReductionTargetMet ? "met" : "not met",
    ],
    ["Avg candidate count", report.summary.avgCandidateCount.toFixed(3)],
    [
      "Avg generated candidate count",
      report.summary.avgGeneratedCandidateCount.toFixed(3),
    ],
    [
      "Avg duplicate candidate count",
      report.summary.avgDuplicateCandidateCount.toFixed(3),
    ],
    ["Avg iterations", report.summary.avgIterations.toFixed(1)],
    ["Avg route hops", report.summary.avgRouteHops.toFixed(3)],
    ["Routes requiring rip", String(report.summary.totalRequiredRipRouteCount)],
    ["Avg solveGraph time", formatDuration(report.summary.avgSolveGraphMs)],
    [
      "Avg section search time",
      formatDuration(report.summary.avgSectionSearchMs),
    ],
    [
      "Avg optimizeSection time",
      formatDuration(report.summary.avgOptimizeSectionMs),
    ],
    [
      "Avg optimizeRegionCosts time",
      formatDuration(report.summary.avgOptimizeRegionCostsMs),
    ],
    ["Avg duration", formatDuration(report.summary.avgDurationMs)],
    ["P50 duration", formatDuration(report.summary.p50DurationMs)],
    ["P95 duration", formatDuration(report.summary.p95DurationMs)],
  ]

  const sampleRows = report.samples.map((sample) => [
    sample.sampleName,
    sample.status,
    `${sample.solvedRouteCount}/${sample.connectionCount}`,
    formatMetric(sample.baselineMaxRegionCost),
    formatMetric(sample.finalMaxRegionCost),
    formatMetric(sample.delta),
    formatMetric(sample.avgRouteHops, 2),
    String(sample.requiredRipRouteCount),
    String(sample.candidateCount),
    String(sample.iterations),
    formatDuration(sample.durationMs),
    sample.referenceCompletionTimeMs === null
      ? "n/a"
      : formatDuration(sample.referenceCompletionTimeMs),
    sample.referenceViaCount === null
      ? "n/a"
      : String(sample.referenceViaCount),
    sample.referenceRelaxedDrcPassed === null
      ? "n/a"
      : sample.referenceRelaxedDrcPassed
        ? "pass"
        : "fail",
    sample.error
      ? truncateTableCell(
          formatMarkdownTableCell(sample.error.split("\n")[0] ?? ""),
          96,
        )
      : "",
  ])

  return `${[
    `Benchmark Results`,
    "",
    `Dataset: ${report.datasetName}`,
    `Source: ${report.datasetSource}`,
    `Revision: ${report.datasetRevision ?? "n/a"}`,
    `Samples: ${report.sampleSelection}`,
    `Solver: ${report.solverVariant}`,
    `Families: ${report.candidateFamilies}`,
    `Concurrency: ${report.concurrency}`,
    `Sample count: ${report.sampleCount}`,
    "",
    ...renderMarkdownTable(["Metric", "Value"], metricRows, ["left", "right"]),
    "",
    ...renderMarkdownTable(
      [
        "Sample",
        "Status",
        "Routes",
        "Baseline Cost",
        "Final Cost",
        "Delta",
        "Avg Hops",
        "Rips",
        "Attempts",
        "Iterations",
        "Duration",
        "Pipeline7 Ref",
        "Ref Vias",
        "Ref DRC",
        "Error",
      ],
      sampleRows,
      [
        "left",
        "left",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
        "right",
        "left",
        "left",
      ],
    ),
  ].join("\n")}\n`
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
  solverVariant: SolverVariant,
) => {
  const { topology, problem, solution } =
    solverVariant === "poly"
      ? loadSerializedHyperGraphAsPoly(serializedHyperGraph)
      : loadSerializedHyperGraph(serializedHyperGraph)
  const replaySolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  return getMaxRegionCost(replaySolver.baselineSolver)
}

const getRouteMetrics = (serializedHyperGraph: SerializedHyperGraph) => {
  if (!serializedHyperGraph.connections) {
    throw new Error("serialized hypergraph is missing connections")
  }

  const solvedRoutes = serializedHyperGraph.solvedRoutes ?? []
  const totalRouteHops = solvedRoutes.reduce(
    (total, route) => total + Math.max(route.path.length - 1, 0),
    0,
  )

  return {
    connectionCount: serializedHyperGraph.connections.length,
    solvedRouteCount: solvedRoutes.length,
    avgRouteHops:
      solvedRoutes.length === 0 ? 0 : totalRouteHops / solvedRoutes.length,
    requiredRipRouteCount: solvedRoutes.filter((route) => route.requiredRip)
      .length,
  }
}

const assertAllConnectionsSolved = (
  serializedHyperGraph: SerializedHyperGraph,
  context: string,
) => {
  if (!serializedHyperGraph.connections) {
    throw new Error(`${context} is missing connections`)
  }

  const connectionIds = serializedHyperGraph.connections.map(
    (connection) => connection.connectionId,
  )
  const solvedConnectionIds = (serializedHyperGraph.solvedRoutes ?? []).map(
    (route) => route.connection.connectionId,
  )
  const solvedConnectionIdSet = new Set(solvedConnectionIds)
  const connectionIdSet = new Set(connectionIds)
  const missingConnectionIds = connectionIds.filter(
    (connectionId) => !solvedConnectionIdSet.has(connectionId),
  )
  const unexpectedConnectionIds = solvedConnectionIds.filter(
    (connectionId) => !connectionIdSet.has(connectionId),
  )

  if (
    solvedConnectionIdSet.size !== solvedConnectionIds.length ||
    missingConnectionIds.length > 0 ||
    unexpectedConnectionIds.length > 0
  ) {
    throw new Error(
      `${context} is incomplete: connections=${connectionIds.length} solvedRoutes=${solvedConnectionIds.length} missing=${missingConnectionIds.length} unexpected=${unexpectedConnectionIds.length}`,
    )
  }
}

const getNextRunDirectory = async (resultsDir: string) => {
  await mkdir(resultsDir, { recursive: true })
  const directoryEntries = await readdir(resultsDir, { withFileTypes: true })
  const existingRunNumbers = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^run(\d+)$/.exec(entry.name)?.[1] ?? null)
    .filter((value): value is string => value !== null)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  const nextRunNumber =
    existingRunNumbers.length === 0 ? 1 : Math.max(...existingRunNumbers) + 1

  return {
    runNumber: nextRunNumber,
    runName: `run${String(nextRunNumber).padStart(3, "0")}`,
  }
}

const loadHg07Dataset = async (
  limit: number | null,
  sampleName: string | null,
): Promise<LoadedDataset> => {
  console.log("loading dataset=hg07")
  const datasetModule = (await import("dataset-hg07")) as DatasetModule
  console.log(
    `loaded dataset=hg07 samples=${datasetModule.manifest.sampleCount}`,
  )
  return {
    datasetModule,
    srj18Cases: new Map(),
    datasetSource: "dataset-hg07",
    datasetRevision: null,
    sampleSelection: sampleName
      ? sampleName
      : limit === null
        ? "all hg07 samples"
        : `first ${limit} hg07 samples`,
  }
}

const getSrj18DatasetDir = async (cwd: string) => {
  const candidateDirs = [
    path.join(cwd, "generated-datasets", "srj18"),
    path.join(
      path.dirname(fileURLToPath(import.meta.resolve("dataset-srj18"))),
      "generated-datasets",
      "srj18",
    ),
  ]

  for (const candidateDir of candidateDirs) {
    try {
      await access(candidateDir)
      return candidateDir
    } catch {
      // Try the next known dataset layout.
    }
  }

  return usageError(
    `Could not find srj18 generated dataset directory. Tried: ${candidateDirs.join(", ")}`,
  )
}

const parseSrj18Json = <T>(json: string): T =>
  JSON.parse(json, (_key, value) =>
    value === "Infinity" ? Number.POSITIVE_INFINITY : value,
  ) as T

const loadSrj18Dataset = async (
  cwd: string,
  limit: number | null,
  sampleName: string | null,
): Promise<LoadedDataset> => {
  const datasetDir = await getSrj18DatasetDir(cwd)
  const manifest = parseSrj18Json<Srj18Manifest>(
    await readFile(path.join(datasetDir, "manifest.json"), "utf8"),
  )
  if (
    manifest.version !== 1 ||
    manifest.sampleCount !== manifest.cases.length
  ) {
    usageError("Invalid srj18 Pipeline7 case manifest")
  }

  const allSampleNames = manifest.cases.map(({ sampleName }) => sampleName)
  if (sampleName && !allSampleNames.includes(sampleName)) {
    usageError(`Unknown sample: ${sampleName}`)
  }

  const requestedSampleNames = sampleName
    ? [sampleName]
    : allSampleNames.slice(
        0,
        limit === null
          ? allSampleNames.length
          : Math.min(limit, allSampleNames.length),
      )

  console.log(`loading dataset=srj18 dir=${datasetDir}`)

  const datasetModule: DatasetModule = {
    manifest: {
      sampleCount: requestedSampleNames.length,
      samples: requestedSampleNames.map((requestedSampleName) => ({
        sampleName: requestedSampleName,
        circuitKey: "srj18",
        circuitId: requestedSampleName,
        stepsToPortPointSolve: 0,
      })),
    },
  }
  const srj18Cases = new Map<string, Srj18BenchmarkCase>()

  for (const requestedSampleName of requestedSampleNames) {
    const manifestCase =
      manifest.cases.find(
        ({ sampleName: candidateName }) =>
          candidateName === requestedSampleName,
      ) ?? usageError(`Unknown sample: ${requestedSampleName}`)
    const caseJson = await readFile(
      path.join(datasetDir, manifestCase.fileName),
      "utf8",
    )
    const actualSha256 = createHash("sha256").update(caseJson).digest("hex")
    if (actualSha256 !== manifestCase.sha256) {
      usageError(`${requestedSampleName} does not match its manifest SHA-256`)
    }
    const benchmarkCase = parseSrj18Json<Srj18BenchmarkCase>(caseJson)
    if (
      benchmarkCase.version !== 1 ||
      benchmarkCase.sampleName !== requestedSampleName ||
      benchmarkCase.solverInput.sectionMaskStrategy !== "all-zero" ||
      benchmarkCase.solverInput.solveGraphSolver !==
        "selective-rerip-stable-initial-assignments"
    ) {
      usageError(`${requestedSampleName} is not a supported Pipeline7 case`)
    }

    assertAllConnectionsSolved(
      benchmarkCase.solverInput.serializedHyperGraph,
      `srj18 ${requestedSampleName} Pipeline7 input`,
    )

    datasetModule[requestedSampleName] =
      benchmarkCase.solverInput.serializedHyperGraph
    srj18Cases.set(requestedSampleName, benchmarkCase)
  }

  console.log(
    `loaded dataset=srj18 selectedSamples=${datasetModule.manifest.sampleCount} committedCases=${allSampleNames.length} autorouterRun=${manifest.source.benchmarkRunId}`,
  )
  return {
    datasetModule,
    srj18Cases,
    datasetSource: "dataset-srj18 committed Pipeline7 tiny-hypergraph inputs",
    datasetRevision: `source dataset-srj18@${manifest.source.datasetCommit}; tscircuit-autorouter@${manifest.source.autorouterCommit}`,
    sampleSelection: sampleName
      ? `${sampleName} from autorouter run ${manifest.source.benchmarkRunId}`
      : limit === null
        ? `all cases completed in autorouter run ${manifest.source.benchmarkRunId}`
        : `first ${requestedSampleNames.length} cases completed in autorouter run ${manifest.source.benchmarkRunId}`,
  }
}

const loadDataset = async (
  datasetKey: DatasetKey,
  cwd: string,
  limit: number | null,
  sampleName: string | null,
): Promise<LoadedDataset> => {
  if (datasetKey === "srj18") {
    return loadSrj18Dataset(cwd, limit, sampleName)
  }

  return loadHg07Dataset(limit, sampleName)
}

const getSelectedSamples = (
  datasetModule: DatasetModule,
  limit: number | null,
  sampleName: string | null,
): DatasetSampleMeta[] => {
  if (sampleName) {
    const sampleMeta = datasetModule.manifest.samples.find(
      ({ sampleName: candidateName }) => candidateName === sampleName,
    )

    if (!sampleMeta) {
      usageError(`Unknown sample: ${sampleName}`)
    }

    const selectedSampleMeta: DatasetSampleMeta = sampleMeta!
    return [selectedSampleMeta]
  }

  const sampleCount =
    limit === null
      ? datasetModule.manifest.sampleCount
      : Math.min(limit, datasetModule.manifest.sampleCount)

  return datasetModule.manifest.samples.slice(0, sampleCount)
}

const toAbsoluteResultPath = (cwd: string, targetPath: string) =>
  path.resolve(cwd, targetPath)

const getSnapshotPng = async (
  pipelineSolver:
    | TinyHyperGraphSectionPipelineSolver
    | PolyHyperGraphSectionPipelineSolver,
): Promise<Uint8Array> => {
  const graphics = stackGraphicsHorizontally(
    [
      pipelineSolver.initialVisualize() as GraphicsObject,
      pipelineSolver.visualize(),
    ],
    { titles: ["initial", "final"] },
  )

  return getPngBufferFromGraphicsObject(graphics, {
    pngWidth: 1600,
    pngHeight: 900,
  })
}

const stringifyLogValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2)

class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return

    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}

const getPipelineInput = (
  serializedHyperGraph: SerializedHyperGraph,
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[] | null,
  benchmarkCase: Srj18BenchmarkCase | undefined,
): TinyHyperGraphSectionPipelineInput => ({
  serializedHyperGraph,
  sectionSearchConfig: candidateFamilies ? { candidateFamilies } : undefined,
  ...(benchmarkCase
    ? {
        solveGraphOptions: { ...benchmarkCase.solverInput.solveGraphOptions },
        sectionSolverOptions: {
          ...benchmarkCase.solverInput.sectionSolverOptions,
        },
        createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
      }
    : {}),
})

const createPipelineSolver = ({
  datasetKey,
  solverVariant,
  serializedHyperGraph,
  candidateFamilies,
  benchmarkCase,
}: {
  datasetKey: DatasetKey
  solverVariant: SolverVariant
  serializedHyperGraph: SerializedHyperGraph
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[] | null
  benchmarkCase: Srj18BenchmarkCase | undefined
}) => {
  const input = getPipelineInput(
    serializedHyperGraph,
    candidateFamilies,
    benchmarkCase,
  )
  const pipelineSolver =
    solverVariant === "poly"
      ? new PolyHyperGraphSectionPipelineSolver(input)
      : new TinyHyperGraphSectionPipelineSolver(input)

  if (datasetKey === "srj18") {
    if (!benchmarkCase) {
      throw new Error("Missing SRJ18 Pipeline7 benchmark case")
    }
    const solveGraphStep = pipelineSolver.pipelineDef.find(
      ({ solverName }) => solverName === "solveGraph",
    )
    if (!solveGraphStep) {
      throw new Error("Section pipeline is missing the solveGraph stage")
    }
    solveGraphStep.solverClass =
      SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments
    pipelineSolver.MAX_ITERATIONS =
      benchmarkCase.solverInput.pipelineMaxIterations
  }

  return pipelineSolver
}

const main = async () => {
  const cwd = process.cwd()
  const {
    limit,
    sampleName,
    candidateFamilies,
    solverVariant,
    datasetKey,
    concurrency,
  } = parseArgs()
  if (datasetKey === "srj18" && solverVariant !== "core") {
    usageError("SRJ18 Pipeline7 cases require --solver core")
  }
  if (datasetKey === "srj18" && candidateFamilies !== null) {
    usageError("SRJ18 Pipeline7 cases use the committed all-zero section mask")
  }
  const loadedDataset = await loadDataset(datasetKey, cwd, limit, sampleName)
  const { datasetModule, srj18Cases } = loadedDataset
  const resultsDir = path.join(cwd, "results")
  const { runName } = await getNextRunDirectory(resultsDir)
  const runDir = path.join(resultsDir, runName)
  const sampleMetas = getSelectedSamples(datasetModule, limit, sampleName)
  const results: BenchmarkSampleResult[] = []

  console.log(
    `dataset=${datasetKey} samples=${sampleMetas.length}/${datasetModule.manifest.sampleCount} run=${runName} solver=${solverVariant} families=${candidateFamilies?.join(",") ?? "default"} concurrency=${concurrency}`,
  )

  for (const sampleMeta of sampleMetas) {
    const sampleStart = performance.now()
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph
    const benchmarkCase = srj18Cases.get(sampleMeta.sampleName)
    const inputRouteMetrics = getRouteMetrics(serializedHyperGraph)
    let pipelineIterations = 0

    try {
      const pipelineSolver = createPipelineSolver({
        datasetKey,
        solverVariant,
        serializedHyperGraph,
        candidateFamilies,
        benchmarkCase,
      })
      pipelineSolver.solve()
      pipelineIterations = pipelineSolver.iterations

      if (pipelineSolver.failed) {
        throw new Error(
          pipelineSolver.error ?? "section pipeline solver failed unexpectedly",
        )
      }

      const solveGraphOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>("solveGraph")
      const optimizeSectionOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>("optimizeSection")
      const optimizeRegionCostsOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>(
          "optimizeRegionCosts",
        )

      if (
        !solveGraphOutput ||
        !optimizeSectionOutput ||
        !optimizeRegionCostsOutput
      ) {
        throw new Error("pipeline did not produce all stage outputs")
      }

      assertAllConnectionsSolved(
        optimizeRegionCostsOutput,
        `${sampleMeta.sampleName} optimized output`,
      )

      const baselineMaxRegionCost = getSerializedOutputMaxRegionCost(
        optimizeSectionOutput,
        solverVariant,
      )
      const finalMaxRegionCost = getSerializedOutputMaxRegionCost(
        optimizeRegionCostsOutput,
        solverVariant,
      )
      const delta = baselineMaxRegionCost - finalMaxRegionCost
      const durationMs = performance.now() - sampleStart
      const optimized = delta > IMPROVEMENT_EPSILON
      const candidateCount = Number(
        pipelineSolver.stats.sectionSearchCandidateCount ?? 0,
      )
      const generatedCandidateCount = Number(
        pipelineSolver.stats.sectionSearchGeneratedCandidateCount ?? 0,
      )
      const duplicateCandidateCount = Number(
        pipelineSolver.stats.sectionSearchDuplicateCandidateCount ?? 0,
      )
      const stageStats = pipelineSolver.getStageStats()
      const solveGraphMs = Number(stageStats.solveGraph?.timeSpent ?? 0)
      const sectionSearchMs = Number(pipelineSolver.stats.sectionSearchMs ?? 0)
      const optimizeSectionMs = Number(
        stageStats.optimizeSection?.timeSpent ?? 0,
      )
      const optimizeRegionCostsMs = Number(
        stageStats.optimizeRegionCosts?.timeSpent ?? 0,
      )
      const finalRouteMetrics = getRouteMetrics(optimizeRegionCostsOutput)

      if (process.env.PROFILE_UNRAVEL === "1") {
        const optimizer = pipelineSolver.getSolver(
          "optimizeRegionCosts",
        ) as TinyHyperGraphSolver & {
          initialSummary?: Record<string, number>
          currentSummary?: Record<string, number>
        }
        console.log(
          `unravel-profile ${sampleMeta.sampleName} ${JSON.stringify({
            initialSummary: optimizer.initialSummary,
            currentSummary: optimizer.currentSummary,
            stats: optimizer.stats,
          })}`,
        )
      }

      const result: BenchmarkSampleResult = {
        sampleName: sampleMeta.sampleName,
        circuitId: sampleMeta.circuitId,
        status: "success",
        durationMs,
        iterations: pipelineIterations,
        connectionCount: finalRouteMetrics.connectionCount,
        solvedRouteCount: finalRouteMetrics.solvedRouteCount,
        routeCompletionRate: formatPercent(
          finalRouteMetrics.solvedRouteCount,
          finalRouteMetrics.connectionCount,
        ),
        avgRouteHops: finalRouteMetrics.avgRouteHops,
        requiredRipRouteCount: finalRouteMetrics.requiredRipRouteCount,
        baselineMaxRegionCost,
        finalMaxRegionCost,
        delta,
        optimized,
        zeroFinalCost: finalMaxRegionCost <= IMPROVEMENT_EPSILON,
        candidateCount,
        generatedCandidateCount,
        duplicateCandidateCount,
        solveGraphMs,
        sectionSearchMs,
        optimizeSectionMs,
        optimizeRegionCostsMs,
        selectedCandidateLabel:
          pipelineSolver.selectedSectionCandidateLabel ?? null,
        selectedCandidateFamily:
          pipelineSolver.selectedSectionCandidateFamily ?? null,
        error: null,
        logsPath: null,
        snapshotPath: null,
        referenceCompletionTimeMs:
          benchmarkCase?.source.completionTimeMs ?? null,
        referenceViaCount: benchmarkCase?.source.viaCount ?? null,
        referenceRelaxedDrcPassed:
          benchmarkCase?.source.relaxedDrcPassed ?? null,
      }
      results.push(result)

      console.log(
        [
          sampleMeta.sampleName.padEnd(9),
          "success".padEnd(7),
          `baselineCost=${formatMetric(baselineMaxRegionCost).padStart(7)}`,
          `finalCost=${formatMetric(finalMaxRegionCost).padStart(7)}`,
          `delta=${formatMetric(delta).padStart(7)}`,
          `routes=${String(finalRouteMetrics.solvedRouteCount).padStart(3)}/${String(finalRouteMetrics.connectionCount).padEnd(3)}`,
          `hops=${formatMetric(finalRouteMetrics.avgRouteHops, 2).padStart(6)}`,
          `rips=${String(finalRouteMetrics.requiredRipRouteCount).padStart(3)}`,
          `attempts=${String(candidateCount).padStart(3)}`,
          `iterations=${String(pipelineIterations).padStart(7)}`,
          `duration=${formatSeconds(durationMs)}`,
        ].join(" "),
      )
      console.log(`# no artifacts written`)
    } catch (error) {
      const durationMs = performance.now() - sampleStart
      const errorMessage =
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      const sampleDir = path.join(runDir, sampleMeta.sampleName)
      const logsPath = path.join(sampleDir, "logs.txt")
      const snapshotPath = path.join(sampleDir, "snapshot.png")
      await mkdir(sampleDir, { recursive: true })
      let wroteSnapshot = false
      let snapshotErrorMessage: string | null = null

      try {
        const pipelineSolver = createPipelineSolver({
          datasetKey,
          solverVariant,
          serializedHyperGraph,
          candidateFamilies,
          benchmarkCase,
        })
        const png = await getSnapshotPng(pipelineSolver)
        await writeFile(snapshotPath, png)
        wroteSnapshot = true
      } catch (snapshotError) {
        snapshotErrorMessage =
          snapshotError instanceof Error
            ? (snapshotError.stack ?? snapshotError.message)
            : String(snapshotError)
      }

      const logLines = [
        `sample=${sampleMeta.sampleName}`,
        `circuitId=${sampleMeta.circuitId}`,
        `status=failed`,
        `duration=${formatSeconds(durationMs)}`,
        "",
        "error=",
        errorMessage,
      ]

      if (snapshotErrorMessage) {
        logLines.push("", "snapshotError=", snapshotErrorMessage)
      }

      await writeFile(logsPath, `${logLines.join("\n")}\n`)

      const result: BenchmarkSampleResult = {
        sampleName: sampleMeta.sampleName,
        circuitId: sampleMeta.circuitId,
        status: "failed",
        durationMs,
        iterations: pipelineIterations,
        connectionCount: inputRouteMetrics.connectionCount,
        solvedRouteCount: 0,
        routeCompletionRate: formatPercent(
          0,
          inputRouteMetrics.connectionCount,
        ),
        avgRouteHops: null,
        requiredRipRouteCount: 0,
        baselineMaxRegionCost: null,
        finalMaxRegionCost: null,
        delta: null,
        optimized: false,
        zeroFinalCost: false,
        candidateCount: 0,
        generatedCandidateCount: 0,
        duplicateCandidateCount: 0,
        solveGraphMs: 0,
        sectionSearchMs: 0,
        optimizeSectionMs: 0,
        optimizeRegionCostsMs: 0,
        selectedCandidateLabel: null,
        selectedCandidateFamily: null,
        error: errorMessage,
        logsPath,
        snapshotPath: wroteSnapshot ? snapshotPath : null,
        referenceCompletionTimeMs:
          benchmarkCase?.source.completionTimeMs ?? null,
        referenceViaCount: benchmarkCase?.source.viaCount ?? null,
        referenceRelaxedDrcPassed:
          benchmarkCase?.source.relaxedDrcPassed ?? null,
      }
      results.push(result)

      console.log(
        [
          sampleMeta.sampleName.padEnd(9),
          "failed".padEnd(7),
          `baselineCost=${formatMetric(null).padStart(7)}`,
          `finalCost=${formatMetric(null).padStart(7)}`,
          `delta=${formatMetric(null).padStart(7)}`,
          `routes=${String(0).padStart(3)}/${String(inputRouteMetrics.connectionCount).padEnd(3)}`,
          `hops=${formatMetric(null, 2).padStart(6)}`,
          `rips=${String(0).padStart(3)}`,
          `attempts=${String(0).padStart(3)}`,
          `iterations=${String(pipelineIterations).padStart(7)}`,
          `duration=${formatSeconds(durationMs)}`,
        ].join(" "),
      )
      console.log(`# wrote ${toAbsoluteResultPath(cwd, logsPath)}`)
      if (wroteSnapshot) {
        console.log(`# wrote ${toAbsoluteResultPath(cwd, snapshotPath)}`)
      } else {
        console.log(`# snapshot skipped renderError=true`)
      }
    }
  }

  const successfulResults = results.filter(
    (result) => result.status === "success",
  )
  const durations = results.map((result) => result.durationMs)
  const deltas = successfulResults
    .map((result) => result.delta)
    .filter((value): value is number => value !== null)
  const baselineCosts = successfulResults
    .map((result) => result.baselineMaxRegionCost)
    .filter((value): value is number => value !== null)
  const finalCosts = successfulResults
    .map((result) => result.finalMaxRegionCost)
    .filter((value): value is number => value !== null)
  const candidateCounts = successfulResults.map(
    (result) => result.candidateCount,
  )
  const generatedCandidateCounts = successfulResults.map(
    (result) => result.generatedCandidateCount,
  )
  const duplicateCandidateCounts = successfulResults.map(
    (result) => result.duplicateCandidateCount,
  )
  const iterations = results.map((result) => result.iterations)
  const routeHops = successfulResults
    .map((result) => result.avgRouteHops)
    .filter((value): value is number => value !== null)
  const totalConnectionCount = results.reduce(
    (total, result) => total + result.connectionCount,
    0,
  )
  const totalSolvedRouteCount = results.reduce(
    (total, result) => total + result.solvedRouteCount,
    0,
  )
  const totalRequiredRipRouteCount = successfulResults.reduce(
    (total, result) => total + result.requiredRipRouteCount,
    0,
  )
  const solveGraphTimes = successfulResults.map((result) => result.solveGraphMs)
  const sectionSearchTimes = successfulResults.map(
    (result) => result.sectionSearchMs,
  )
  const optimizeSectionTimes = successfulResults.map(
    (result) => result.optimizeSectionMs,
  )
  const optimizeRegionCostsTimes = successfulResults.map(
    (result) => result.optimizeRegionCostsMs,
  )
  const successCount = successfulResults.length
  const improvedCount = successfulResults.filter(
    (result) => result.optimized,
  ).length
  const zeroFinalCostCount = successfulResults.filter(
    (result) => result.zeroFinalCost,
  ).length
  const p50BaselineMaxRegionCost = percentile(baselineCosts, 50)
  const p50FinalMaxRegionCost = percentile(finalCosts, 50)
  const p95BaselineMaxRegionCost = percentile(baselineCosts, 95)
  const p95FinalMaxRegionCost = percentile(finalCosts, 95)
  const p50MaxRegionCostReductionRate = getReductionRate(
    p50BaselineMaxRegionCost,
    p50FinalMaxRegionCost,
  )
  const p95MaxRegionCostReductionRate = getReductionRate(
    p95BaselineMaxRegionCost,
    p95FinalMaxRegionCost,
  )

  const report: BenchmarkReport = {
    version: 1,
    datasetName: datasetKey,
    datasetSource: loadedDataset.datasetSource,
    datasetRevision: loadedDataset.datasetRevision,
    sampleSelection: loadedDataset.sampleSelection,
    solverVariant,
    candidateFamilies: candidateFamilies?.join(",") ?? "default",
    concurrency,
    sampleCount: results.length,
    successCount,
    failedCount: results.length - successCount,
    improvedCount,
    zeroFinalCostCount,
    summary: {
      successRate: formatPercent(successCount, results.length),
      routeCompletionRate: formatPercent(
        totalSolvedRouteCount,
        totalConnectionCount,
      ),
      improvedRate: formatPercent(improvedCount, successCount),
      zeroFinalCostRate: formatPercent(zeroFinalCostCount, successCount),
      totalDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
      avgBaselineMaxRegionCost: average(baselineCosts),
      avgFinalMaxRegionCost: average(finalCosts),
      avgMaxRegionDelta: average(deltas),
      p50BaselineMaxRegionCost,
      p50FinalMaxRegionCost,
      p50MaxRegionCostReductionRate: formatReductionRate(
        p50BaselineMaxRegionCost,
        p50FinalMaxRegionCost,
      ),
      p95BaselineMaxRegionCost,
      p95FinalMaxRegionCost,
      p95MaxRegionCostReductionRate: formatReductionRate(
        p95BaselineMaxRegionCost,
        p95FinalMaxRegionCost,
      ),
      regionCostReductionTargetMet:
        p50MaxRegionCostReductionRate >= REGION_COST_REDUCTION_TARGET &&
        p95MaxRegionCostReductionRate >= REGION_COST_REDUCTION_TARGET,
      avgCandidateCount: average(candidateCounts),
      avgGeneratedCandidateCount: average(generatedCandidateCounts),
      avgDuplicateCandidateCount: average(duplicateCandidateCounts),
      avgIterations: average(iterations),
      avgRouteHops: average(routeHops),
      totalRequiredRipRouteCount,
      avgSolveGraphMs: average(solveGraphTimes),
      avgSectionSearchMs: average(sectionSearchTimes),
      avgOptimizeSectionMs: average(optimizeSectionTimes),
      avgOptimizeRegionCostsMs: average(optimizeRegionCostsTimes),
      avgDurationMs: average(durations),
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
    },
    samples: results,
  }

  const reportText = formatBenchmarkReportText(report)

  console.log("")
  console.log(reportText.trimEnd())

  await writeFile("benchmark-result.txt", reportText)
  await writeFile(
    "benchmark-result.json",
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(
    "Results written to benchmark-result.txt and benchmark-result.json",
  )
}

await main()
