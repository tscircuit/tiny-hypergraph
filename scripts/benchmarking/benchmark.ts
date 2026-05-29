import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getPngBufferFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { availableParallelism } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  PolyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionCandidateFamily,
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

type BenchmarkSampleResult = {
  sampleName: string
  circuitId: string
  status: "success" | "failed"
  durationMs: number
  baselineMaxRegionCost: number | null
  finalMaxRegionCost: number | null
  delta: number | null
  optimized: boolean
  zeroFinalCost: boolean
  candidateCount: number
  generatedCandidateCount: number
  duplicateCandidateCount: number
  selectedCandidateLabel: string | null
  selectedCandidateFamily: string | null
  error: string | null
  logsPath: string | null
  snapshotPath: string | null
}

type BenchmarkReport = {
  version: 1
  datasetName: DatasetKey
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
    improvedRate: string
    zeroFinalCostRate: string
    avgBaselineMaxRegionCost: number
    avgFinalMaxRegionCost: number
    avgMaxRegionDelta: number
    avgCandidateCount: number
    avgDurationMs: number
    p50DurationMs: number
    p95DurationMs: number
  }
  samples: BenchmarkSampleResult[]
}

type SolverVariant = "core" | "poly"
type DatasetKey = "hg07" | "srj18"

const IMPROVEMENT_EPSILON = 1e-9

const HELP_TEXT = `Usage: ./benchmark.sh [options]

Run the section-pipeline benchmark and write per-sample artifacts under ./results/runNNN/.

Options:
  --dataset NAME  Dataset to run: hg07 or 18/srj18. Defaults to hg07.
  --limit N       Run the first N samples from the dataset.
  --sample NUM    Run a specific sample by number or name (e.g. 2, 002, sample002).
  --solver NAME   Solver variant: core or poly. Defaults to core.
  --concurrency N Benchmark concurrency value, or "auto". Defaults to BENCHMARK_CONCURRENCY or CPU count.
  --families LIST Override candidate families. Use a preset (default, default+deep, all)
                  or a comma-separated list such as self-touch,onehop-all,twohop-touch.
  --help          Show this help text.

Examples:
  ./benchmark.sh
  ./benchmark.sh --dataset 18
  ./benchmark.sh --limit 20
  ./benchmark.sh --limit 20 --concurrency 4
  ./benchmark.sh --limit 20 --solver poly
  ./benchmark.sh --sample 2
  ./benchmark.sh --sample sample002
  ./benchmark.sh --limit 40 --families default+deep

Outputs:
  - Incremental progress lines always include duration=... for hillclimbing workflows.
  - Failed samples write ./results/runNNN/sampleXXX/logs.txt
  - Failed samples also write ./results/runNNN/sampleXXX/snapshot.png

Summary metrics:
  - success rate
  - improved rate
  - zero-final-max-region-cost rate
  - avg / P50 / P95 duration
  - avg baseline/final max region cost and avg delta
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
    ["Improved rate", report.summary.improvedRate],
    ["Zero final max region cost rate", report.summary.zeroFinalCostRate],
    [
      "Avg baseline max region cost",
      report.summary.avgBaselineMaxRegionCost.toFixed(3),
    ],
    [
      "Avg final max region cost",
      report.summary.avgFinalMaxRegionCost.toFixed(3),
    ],
    ["Avg max region delta", report.summary.avgMaxRegionDelta.toFixed(3)],
    ["Avg candidate count", report.summary.avgCandidateCount.toFixed(3)],
    ["Avg duration", formatDuration(report.summary.avgDurationMs)],
    ["P50 duration", formatDuration(report.summary.p50DurationMs)],
    ["P95 duration", formatDuration(report.summary.p95DurationMs)],
  ]

  const sampleRows = report.samples.map((sample) => [
    sample.sampleName,
    sample.status,
    formatMetric(sample.baselineMaxRegionCost),
    formatMetric(sample.finalMaxRegionCost),
    formatMetric(sample.delta),
    String(sample.candidateCount),
    formatDuration(sample.durationMs),
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
    `Solver: ${report.solverVariant}`,
    `Families: ${report.candidateFamilies}`,
    `Concurrency: ${report.concurrency}`,
    `Samples: ${report.sampleCount}`,
    "",
    ...renderMarkdownTable(["Metric", "Value"], metricRows, ["left", "right"]),
    "",
    ...renderMarkdownTable(
      [
        "Sample",
        "Status",
        "Baseline Cost",
        "Final Cost",
        "Delta",
        "Attempts",
        "Duration",
        "Error",
      ],
      sampleRows,
      ["left", "left", "right", "right", "right", "right", "right", "left"],
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

const loadHg07DatasetModule = async (): Promise<DatasetModule> => {
  console.log("loading dataset=hg07")
  const datasetModule = (await import("dataset-hg07")) as DatasetModule
  console.log(
    `loaded dataset=hg07 samples=${datasetModule.manifest.sampleCount}`,
  )
  return datasetModule
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

const getSrj18SampleNames = async (datasetDir: string) =>
  (await readdir(datasetDir))
    .map((entryName) => /^(sample\d+)\.hg\.json$/.exec(entryName)?.[1] ?? null)
    .filter((sampleName): sampleName is string => sampleName !== null)
    .sort((leftSampleName, rightSampleName) =>
      leftSampleName.localeCompare(rightSampleName),
    )

const loadSrj18DatasetModule = async (
  cwd: string,
  limit: number | null,
  sampleName: string | null,
): Promise<DatasetModule> => {
  const datasetDir = await getSrj18DatasetDir(cwd)
  const allSampleNames = await getSrj18SampleNames(datasetDir)
  if (sampleName && !allSampleNames.includes(sampleName)) {
    usageError(`Unknown sample: ${sampleName}`)
  }

  const requestedSampleNames: string[] = sampleName
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
      sampleCount: allSampleNames.length,
      samples: allSampleNames.map((srj18SampleName) => ({
        sampleName: srj18SampleName,
        circuitKey: "srj18",
        circuitId: srj18SampleName,
        stepsToPortPointSolve: 0,
      })),
    },
  }

  for (const srj18SampleName of requestedSampleNames) {
    const serializedHyperGraph = JSON.parse(
      await readFile(
        path.join(datasetDir, `${srj18SampleName}.hg.json`),
        "utf8",
      ),
    ) as SerializedHyperGraph

    datasetModule[srj18SampleName] = serializedHyperGraph
  }

  console.log(
    `loaded dataset=srj18 samples=${datasetModule.manifest.sampleCount}`,
  )
  return datasetModule
}

const loadDatasetModule = async (
  datasetKey: DatasetKey,
  cwd: string,
  limit: number | null,
  sampleName: string | null,
): Promise<DatasetModule> => {
  if (datasetKey === "srj18") {
    return loadSrj18DatasetModule(cwd, limit, sampleName)
  }

  return loadHg07DatasetModule()
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
  const datasetModule = await loadDatasetModule(
    datasetKey,
    cwd,
    limit,
    sampleName,
  )
  const resultsDir = path.join(cwd, "results")
  const { runName } = await getNextRunDirectory(resultsDir)
  const runDir = path.join(resultsDir, runName)
  const sampleMetas = getSelectedSamples(datasetModule, limit, sampleName)
  const results: BenchmarkSampleResult[] = []

  const PipelineSolver =
    solverVariant === "poly"
      ? PolyHyperGraphSectionPipelineSolver
      : TinyHyperGraphSectionPipelineSolver

  console.log(
    `dataset=${datasetKey} samples=${sampleMetas.length}/${datasetModule.manifest.sampleCount} run=${runName} solver=${solverVariant} families=${candidateFamilies?.join(",") ?? "default"} concurrency=${concurrency}`,
  )

  for (const sampleMeta of sampleMetas) {
    const sampleStart = performance.now()
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      const pipelineSolver = new PipelineSolver({
        serializedHyperGraph,
        sectionSearchConfig: candidateFamilies
          ? { candidateFamilies }
          : undefined,
      })
      pipelineSolver.solve()

      if (pipelineSolver.failed) {
        throw new Error(
          pipelineSolver.error ?? "section pipeline solver failed unexpectedly",
        )
      }

      const solveGraphOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>("solveGraph")
      const optimizeSectionOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>("optimizeSection")

      if (!solveGraphOutput || !optimizeSectionOutput) {
        throw new Error("pipeline did not produce both stage outputs")
      }

      const baselineMaxRegionCost = getSerializedOutputMaxRegionCost(
        solveGraphOutput,
        solverVariant,
      )
      const finalMaxRegionCost = getSerializedOutputMaxRegionCost(
        optimizeSectionOutput,
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

      const result: BenchmarkSampleResult = {
        sampleName: sampleMeta.sampleName,
        circuitId: sampleMeta.circuitId,
        status: "success",
        durationMs,
        baselineMaxRegionCost,
        finalMaxRegionCost,
        delta,
        optimized,
        zeroFinalCost: finalMaxRegionCost <= IMPROVEMENT_EPSILON,
        candidateCount,
        generatedCandidateCount,
        duplicateCandidateCount,
        selectedCandidateLabel:
          pipelineSolver.selectedSectionCandidateLabel ?? null,
        selectedCandidateFamily:
          pipelineSolver.selectedSectionCandidateFamily ?? null,
        error: null,
        logsPath: null,
        snapshotPath: null,
      }
      results.push(result)

      console.log(
        [
          sampleMeta.sampleName.padEnd(9),
          "success".padEnd(7),
          `baselineCost=${formatMetric(baselineMaxRegionCost).padStart(7)}`,
          `finalCost=${formatMetric(finalMaxRegionCost).padStart(7)}`,
          `delta=${formatMetric(delta).padStart(7)}`,
          `attempts=${String(candidateCount).padStart(3)}`,
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
        const pipelineSolver = new PipelineSolver({
          serializedHyperGraph,
          sectionSearchConfig: candidateFamilies
            ? { candidateFamilies }
            : undefined,
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
        baselineMaxRegionCost: null,
        finalMaxRegionCost: null,
        delta: null,
        optimized: false,
        zeroFinalCost: false,
        candidateCount: 0,
        generatedCandidateCount: 0,
        duplicateCandidateCount: 0,
        selectedCandidateLabel: null,
        selectedCandidateFamily: null,
        error: errorMessage,
        logsPath,
        snapshotPath: wroteSnapshot ? snapshotPath : null,
      }
      results.push(result)

      console.log(
        [
          sampleMeta.sampleName.padEnd(9),
          "failed".padEnd(7),
          `baselineCost=${formatMetric(null).padStart(7)}`,
          `finalCost=${formatMetric(null).padStart(7)}`,
          `delta=${formatMetric(null).padStart(7)}`,
          `attempts=${String(0).padStart(3)}`,
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
  const successCount = successfulResults.length
  const improvedCount = successfulResults.filter(
    (result) => result.optimized,
  ).length
  const zeroFinalCostCount = successfulResults.filter(
    (result) => result.zeroFinalCost,
  ).length

  const report: BenchmarkReport = {
    version: 1,
    datasetName: datasetKey,
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
      improvedRate: formatPercent(improvedCount, successCount),
      zeroFinalCostRate: formatPercent(zeroFinalCostCount, successCount),
      avgBaselineMaxRegionCost: average(baselineCosts),
      avgFinalMaxRegionCost: average(finalCosts),
      avgMaxRegionDelta: average(deltas),
      avgCandidateCount: average(candidateCounts),
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
