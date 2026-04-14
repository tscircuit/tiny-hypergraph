import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getPngBufferFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
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

const IMPROVEMENT_EPSILON = 1e-9

const HELP_TEXT = `Usage: ./benchmark.sh [options]

Run the hg07 section-pipeline benchmark and write per-sample artifacts under ./results/runNNN/.

Options:
  --limit N       Run the first N samples from the dataset.
  --sample NUM    Run a specific sample by number or name (e.g. 2, 002, sample002).
  --help          Show this help text.

Examples:
  ./benchmark.sh
  ./benchmark.sh --limit 20
  ./benchmark.sh --sample 2
  ./benchmark.sh --sample sample002

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

const parseArgs = () => {
  let limit: number | null = null
  let sampleName: string | null = null

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

    if (arg === "--sample") {
      const rawValue = process.argv[index + 1]
      if (!rawValue) {
        usageError("Missing value for --sample")
      }

      sampleName = formatSampleName(rawValue)
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

  return { limit, sampleName }
}

const formatSeconds = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`

const formatMetric = (value: number | null, digits = 3) =>
  value === null ? "n/a" : value.toFixed(digits)

const formatPercent = (numerator: number, denominator: number) =>
  `${((numerator / Math.max(denominator, 1)) * 100).toFixed(1)}%`

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

const loadDatasetModule = async (): Promise<DatasetModule> => {
  console.log("loading dataset=hg07")
  const datasetModule = (await import("dataset-hg07")) as DatasetModule
  console.log(
    `loaded dataset=hg07 samples=${datasetModule.manifest.sampleCount}`,
  )
  return datasetModule
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
  pipelineSolver: TinyHyperGraphSectionPipelineSolver,
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
  const { limit, sampleName } = parseArgs()
  const datasetModule = await loadDatasetModule()
  const cwd = process.cwd()
  const resultsDir = path.join(cwd, "results")
  const { runName } = await getNextRunDirectory(resultsDir)
  const runDir = path.join(resultsDir, runName)
  const sampleMetas = getSelectedSamples(datasetModule, limit, sampleName)
  const results: BenchmarkSampleResult[] = []

  console.log(
    `dataset=hg07 samples=${sampleMetas.length}/${datasetModule.manifest.sampleCount} run=${runName}`,
  )

  for (const sampleMeta of sampleMetas) {
    const sampleStart = performance.now()
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

      const solveGraphOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>("solveGraph")
      const optimizeSectionOutput =
        pipelineSolver.getStageOutput<SerializedHyperGraph>("optimizeSection")

      if (!solveGraphOutput || !optimizeSectionOutput) {
        throw new Error("pipeline did not produce both stage outputs")
      }

      const baselineMaxRegionCost =
        getSerializedOutputMaxRegionCost(solveGraphOutput)
      const finalMaxRegionCost = getSerializedOutputMaxRegionCost(
        optimizeSectionOutput,
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
        const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
          serializedHyperGraph,
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

  console.log(`success rate: ${formatPercent(successCount, results.length)}`)
  console.log(`improved rate: ${formatPercent(improvedCount, successCount)}`)
  console.log(
    `zero-final-max-region-cost rate: ${formatPercent(zeroFinalCostCount, successCount)}`,
  )
  console.log(
    `avg baseline max region cost: ${average(baselineCosts).toFixed(3)}`,
  )
  console.log(`avg final max region cost: ${average(finalCosts).toFixed(3)}`)
  console.log(`avg max region delta: ${average(deltas).toFixed(3)}`)
  console.log(`avg candidate count: ${average(candidateCounts).toFixed(3)}`)
  console.log(`avg duration: ${formatSeconds(average(durations))}`)
  console.log(`P50 duration: ${formatSeconds(percentile(durations, 50))}`)
  console.log(`P95 duration: ${formatSeconds(percentile(durations, 95))}`)
}

await main()
