import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "../../lib/index"

type Srj18Pipeline7Case = {
  sampleName: string
  extractionStatus: "success" | "failed"
  extractionError: string | null
  solverInput?: {
    serializedHyperGraph: SerializedHyperGraph
    solveGraphOptions?: TinyHyperGraphSolverOptions
    sectionSolverOptions?: TinyHyperGraphSectionSolverOptions
    createSectionMask?: string
  }
  resultSummary: {
    regionCount?: number
    portCount?: number
    connectionCount?: number
  }
}

type Srj18Pipeline7Manifest = {
  sampleCount: number
  cases: Array<{
    sampleName: string
    extractionStatus: "success" | "failed"
    extractionError: string | null
    resultSummary: Srj18Pipeline7Case["resultSummary"]
  }>
}

type BenchmarkResult = {
  sampleName: string
  status: "success" | "failed"
  durationMs: number
  iterations: number
  regionCount: number
  portCount: number
  connectionCount: number
  error: string | null
}

const DATASET_DIR = fileURLToPath(
  new URL("../../datasets/srj18-pipeline7/", import.meta.url),
)

const HELP_TEXT = `Usage: ./benchmark-srj18-pipeline7.sh [options]

Run the local SRJ18 pipeline-7 tiny-hypergraph dataset through TinyHyperGraphSectionPipelineSolver.
Some samples are expected to fail or run out of iterations.

Options:
  --limit N              Run the first N samples.
  --sample NUM           Run a specific sample number or name.
  --max-iterations N     Cap both tiny solve stages to N iterations.
  --strict               Exit non-zero if any sample fails.
  --help                 Show this help text.
`

const usageError = (message: string): never => {
  console.error(message)
  console.error("")
  console.error(HELP_TEXT)
  process.exit(1)
}

const parsePositiveInteger = (flag: string, rawValue: string | undefined) => {
  const parsedValue = Number(rawValue)

  if (!rawValue || !Number.isInteger(parsedValue) || parsedValue <= 0) {
    usageError(`Invalid ${flag} value: ${rawValue ?? "<missing>"}`)
  }

  return parsedValue
}

const formatSampleName = (value: string) => {
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
  let maxIterations: number | null = null
  let strict = false

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]

    if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT)
      process.exit(0)
    }

    if (arg === "--strict") {
      strict = true
      continue
    }

    if (arg === "--limit") {
      limit = parsePositiveInteger(arg, process.argv[index + 1])
      index += 1
      continue
    }

    if (arg === "--sample") {
      const rawValue = process.argv[index + 1]
      if (!rawValue) usageError("Missing value for --sample")
      sampleName = formatSampleName(rawValue)
      index += 1
      continue
    }

    if (arg === "--max-iterations") {
      maxIterations = parsePositiveInteger(arg, process.argv[index + 1])
      index += 1
      continue
    }

    usageError(`Unknown option: ${arg}`)
  }

  if (limit !== null && sampleName !== null) {
    usageError("Use either --limit or --sample, not both")
  }

  return { limit, sampleName, maxIterations, strict }
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T

const loadManifest = () =>
  readJson<Srj18Pipeline7Manifest>(`${DATASET_DIR}/manifest.json`)

const loadCase = (sampleName: string) =>
  readJson<Srj18Pipeline7Case>(
    `${DATASET_DIR}/${sampleName}.tiny-hypergraph.json`,
  )

const createPipelineInput = (
  benchmarkCase: Srj18Pipeline7Case,
  maxIterations: number | null,
): TinyHyperGraphSectionPipelineInput => {
  if (!benchmarkCase.solverInput) {
    throw new Error(benchmarkCase.extractionError ?? "missing solver input")
  }

  const solveGraphOptions = {
    ...(benchmarkCase.solverInput.solveGraphOptions ?? {}),
  }
  const sectionSolverOptions = {
    ...(benchmarkCase.solverInput.sectionSolverOptions ?? {}),
  }

  if (maxIterations !== null) {
    solveGraphOptions.MAX_ITERATIONS = maxIterations
    sectionSolverOptions.MAX_ITERATIONS = maxIterations
  }

  return {
    serializedHyperGraph: benchmarkCase.solverInput.serializedHyperGraph,
    solveGraphOptions,
    sectionSolverOptions,
    createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
  }
}

const runSample = async (
  sampleName: string,
  maxIterations: number | null,
): Promise<BenchmarkResult> => {
  const benchmarkCase = await loadCase(sampleName)
  const startTime = performance.now()
  const resultSummary = benchmarkCase.resultSummary
  let solver: TinyHyperGraphSectionPipelineSolver | null = null

  try {
    solver = new TinyHyperGraphSectionPipelineSolver(
      createPipelineInput(benchmarkCase, maxIterations),
    )
    solver.solve()

    return {
      sampleName,
      status: solver.solved && !solver.failed ? "success" : "failed",
      durationMs: performance.now() - startTime,
      iterations: solver.iterations,
      regionCount: resultSummary.regionCount ?? 0,
      portCount: resultSummary.portCount ?? 0,
      connectionCount: resultSummary.connectionCount ?? 0,
      error:
        solver.failed || !solver.solved
          ? (solver.error ?? "pipeline solver did not solve")
          : null,
    }
  } catch (error) {
    return {
      sampleName,
      status: "failed",
      durationMs: performance.now() - startTime,
      iterations: solver?.iterations ?? 0,
      regionCount: resultSummary.regionCount ?? 0,
      portCount: resultSummary.portCount ?? 0,
      connectionCount: resultSummary.connectionCount ?? 0,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    }
  }
}

const formatSeconds = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`

const formatPercent = (numerator: number, denominator: number) =>
  `${((numerator / Math.max(denominator, 1)) * 100).toFixed(1)}%`

const main = async () => {
  const { limit, sampleName, maxIterations, strict } = parseArgs()
  const manifest = await loadManifest()
  const sampleNames = manifest.cases.map((sample) => sample.sampleName)
  const selectedSampleNames = sampleName
    ? [sampleName]
    : limit === null
      ? sampleNames
      : sampleNames.slice(0, limit)
  const results: BenchmarkResult[] = []

  console.log(
    `dataset=srj18-pipeline7 samples=${selectedSampleNames.length}/${manifest.sampleCount} solver=section-pipeline maxIterations=${maxIterations ?? "dataset"}`,
  )

  for (const name of selectedSampleNames) {
    const result = await runSample(name, maxIterations)
    results.push(result)

    console.log(
      [
        result.sampleName.padEnd(10),
        result.status.padEnd(7),
        `regions=${String(result.regionCount).padStart(5)}`,
        `ports=${String(result.portCount).padStart(6)}`,
        `connections=${String(result.connectionCount).padStart(3)}`,
        `iterations=${String(result.iterations).padStart(7)}`,
        `duration=${formatSeconds(result.durationMs)}`,
      ].join(" "),
    )

    if (result.error) {
      console.log(`# error=${JSON.stringify(result.error.split("\n")[0])}`)
    }
  }

  const successfulResults = results.filter(
    (result) => result.status === "success",
  )
  console.log(
    `success rate: ${formatPercent(successfulResults.length, results.length)}`,
  )
  console.log(`failure count: ${results.length - successfulResults.length}`)

  if (strict && successfulResults.length !== results.length) {
    process.exit(1)
  }
}

main()
