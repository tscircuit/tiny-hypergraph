import {
  samples as srj13Samples,
  type TinyHypergraphBenchmarkCase,
} from "@tsci/seveibar.dataset-srj13"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "../../lib/index"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"

type Srj13BenchmarkSample = {
  sampleName: string
  tinyHypergraphBenchmark: TinyHypergraphBenchmarkCase
}

type BenchmarkResult = {
  sampleName: string
  status: "success" | "failed"
  durationMs: number
  iterations: number
  routeCount: number
  regionCount: number
  portCount: number
  ripCount: number | null
  maxRegionCost: number | null
  neverSuccessfullyRoutedRouteCount: number | null
  error: string | null
}

const HELP_TEXT = `Usage: ./benchmark-srj13.sh [options]

Run the SRJ13 tiny-hypergraph benchmark against TinyHyperGraphSolver directly.
This intentionally skips the section pipeline. Many samples are expected to fail.

Options:
  --limit N              Run the first N samples from the dataset.
  --sample NUM           Run a specific sample by number or name (e.g. 2, 02, example-02).
  --max-iterations N     Override the core solver iteration cap. Defaults to 1000000.
  --strict               Exit non-zero if any sample fails.
  --help                 Show this help text.

Examples:
  ./benchmark-srj13.sh
  ./benchmark-srj13.sh --limit 3
  ./benchmark-srj13.sh --sample example-02
  ./benchmark-srj13.sh --max-iterations 250000
`

const usageError = (message: string): never => {
  console.error(message)
  console.error("")
  console.error(HELP_TEXT)
  process.exit(1)
}

const formatSampleName = (value: string): string => {
  if (/^example-\d+$/i.test(value)) {
    const digits = value.replace(/^example-/i, "")
    return `example-${digits.padStart(2, "0")}`
  }

  if (/^\d+$/.test(value)) {
    return `example-${value.padStart(2, "0")}`
  }

  return usageError(`Invalid --sample value: ${value}`)
}

const parsePositiveInteger = (flag: string, rawValue: string | undefined) => {
  const parsedValue = Number(rawValue)

  if (!rawValue || !Number.isInteger(parsedValue) || parsedValue <= 0) {
    usageError(`Invalid ${flag} value: ${rawValue ?? "<missing>"}`)
  }

  return parsedValue
}

const parseArgs = () => {
  let limit: number | null = null
  let sampleName: string | null = null
  let maxIterations = 1_000_000
  let strict = false

  for (let index = 0; index < process.argv.length; index += 1) {
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
      if (!rawValue) {
        usageError("Missing value for --sample")
      }

      sampleName = formatSampleName(rawValue)
      index += 1
      continue
    }

    if (arg === "--max-iterations") {
      maxIterations = parsePositiveInteger(arg, process.argv[index + 1])
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

  return { limit, sampleName, maxIterations, strict }
}

const formatSeconds = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`

const formatMetric = (value: number | null, digits = 3) =>
  value === null ? "n/a" : value.toFixed(digits)

const formatPercent = (numerator: number, denominator: number) =>
  `${((numerator / Math.max(denominator, 1)) * 100).toFixed(1)}%`

const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length

const getNumberStat = (stats: Record<string, unknown>, key: string) => {
  const value = stats[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const getSelectedSamples = (
  samples: Srj13BenchmarkSample[],
  limit: number | null,
  sampleName: string | null,
) => {
  if (sampleName) {
    const sample = samples.find(
      (candidate) => candidate.sampleName === sampleName,
    )

    if (!sample) {
      usageError(`Unknown sample: ${sampleName}`)
    }

    return [sample!]
  }

  return limit === null ? samples : samples.slice(0, limit)
}

const normalizeSerializedHyperGraph = (
  benchmarkCase: TinyHypergraphBenchmarkCase,
): SerializedHyperGraph => {
  const solverInput = benchmarkCase.solverInput as {
    graph: {
      regions: Array<Record<string, unknown>>
      ports: SerializedHyperGraph["ports"]
    }
    connections: NonNullable<SerializedHyperGraph["connections"]>
  }

  return {
    regions: solverInput.graph.regions.map((region) => ({
      ...region,
      pointIds: Array.isArray(region.pointIds)
        ? region.pointIds
        : Array.isArray(region.portIds)
          ? region.portIds
          : [],
    })) as SerializedHyperGraph["regions"],
    ports: solverInput.graph.ports,
    connections: solverInput.connections,
  }
}

const getSolverOptions = (
  benchmarkCase: TinyHypergraphBenchmarkCase,
  maxIterations: number,
): TinyHyperGraphSolverOptions => {
  const solverInput = benchmarkCase.solverInput as {
    minViaPadDiameter?: unknown
    min_via_pad_diameter?: unknown
  }
  const minViaPadDiameter = Number(
    solverInput.minViaPadDiameter ?? solverInput.min_via_pad_diameter,
  )

  return {
    MAX_ITERATIONS: maxIterations,
    ...(Number.isFinite(minViaPadDiameter) && minViaPadDiameter > 0
      ? { minViaPadDiameter }
      : {}),
  }
}

const runSample = (
  sample: Srj13BenchmarkSample,
  maxIterations: number,
): BenchmarkResult => {
  const startTime = performance.now()
  const benchmarkCase = sample.tinyHypergraphBenchmark
  const serializedHyperGraph = normalizeSerializedHyperGraph(benchmarkCase)
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new TinyHyperGraphSolver(
    topology,
    problem,
    getSolverOptions(benchmarkCase, maxIterations),
  )

  try {
    solver.solve()

    return {
      sampleName: sample.sampleName,
      status: solver.solved && !solver.failed ? "success" : "failed",
      durationMs: performance.now() - startTime,
      iterations: solver.iterations,
      routeCount: problem.routeCount,
      regionCount: topology.regionCount,
      portCount: topology.portCount,
      ripCount: getNumberStat(solver.stats, "ripCount"),
      maxRegionCost: getNumberStat(solver.stats, "maxRegionCost"),
      neverSuccessfullyRoutedRouteCount: getNumberStat(
        solver.stats,
        "neverSuccessfullyRoutedRouteCount",
      ),
      error:
        solver.failed || !solver.solved
          ? (solver.error ?? "core solver did not solve")
          : null,
    }
  } catch (error) {
    return {
      sampleName: sample.sampleName,
      status: "failed",
      durationMs: performance.now() - startTime,
      iterations: solver.iterations,
      routeCount: problem.routeCount,
      regionCount: topology.regionCount,
      portCount: topology.portCount,
      ripCount: getNumberStat(solver.stats, "ripCount"),
      maxRegionCost: getNumberStat(solver.stats, "maxRegionCost"),
      neverSuccessfullyRoutedRouteCount: getNumberStat(
        solver.stats,
        "neverSuccessfullyRoutedRouteCount",
      ),
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    }
  }
}

const main = () => {
  const { limit, sampleName, maxIterations, strict } = parseArgs()
  const allSamples = srj13Samples as Srj13BenchmarkSample[]
  const selectedSamples = getSelectedSamples(allSamples, limit, sampleName)
  const results: BenchmarkResult[] = []

  console.log(
    `dataset=srj13 solver=core samples=${selectedSamples.length}/${allSamples.length} maxIterations=${maxIterations}`,
  )

  for (const sample of selectedSamples) {
    const result = runSample(sample, maxIterations)
    results.push(result)

    console.log(
      [
        result.sampleName.padEnd(10),
        result.status.padEnd(7),
        `routes=${String(result.routeCount).padStart(4)}`,
        `regions=${String(result.regionCount).padStart(5)}`,
        `ports=${String(result.portCount).padStart(6)}`,
        `iterations=${String(result.iterations).padStart(7)}`,
        `rips=${String(result.ripCount ?? "n/a").padStart(3)}`,
        `maxCost=${formatMetric(result.maxRegionCost).padStart(7)}`,
        `neverRouted=${String(result.neverSuccessfullyRoutedRouteCount ?? "n/a").padStart(3)}`,
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
  const failedResults = results.filter((result) => result.status === "failed")
  const durations = results.map((result) => result.durationMs)
  const iterations = results.map((result) => result.iterations)
  const maxRegionCosts = successfulResults
    .map((result) => result.maxRegionCost)
    .filter((value): value is number => value !== null)

  console.log(
    `success rate: ${formatPercent(successfulResults.length, results.length)}`,
  )
  console.log(`failure count: ${failedResults.length}`)
  console.log(`avg duration: ${formatSeconds(average(durations))}`)
  console.log(`avg iterations: ${average(iterations).toFixed(1)}`)
  console.log(
    `avg solved max region cost: ${
      maxRegionCosts.length === 0
        ? "n/a"
        : formatMetric(average(maxRegionCosts))
    }`,
  )

  if (strict && failedResults.length > 0) {
    process.exit(1)
  }
}

main()
