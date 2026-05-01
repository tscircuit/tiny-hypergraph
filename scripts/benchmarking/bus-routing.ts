import {
  samples as busDatasetSamples,
  type TinyHypergraphBenchmarkCase,
} from "@tsci/tscircuit.dataset-srj12-bus-routing"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSectionPipelineSolver } from "../../lib/index"

type BusBenchmarkSample = {
  sampleName: string
  tinyHypergraphBenchmark: TinyHypergraphBenchmarkCase
}

type ComparableStats = {
  sectionSearchGeneratedCandidateCount: number | null
  sectionSearchCandidateCount: number | null
  sectionSearchDuplicateCandidateCount: number | null
  sectionSearchBaselineMaxRegionCost: number | null
  sectionSearchFinalMaxRegionCost: number | null
  sectionSearchDelta: number | null
  selectedSectionCandidateLabel: string | null
  selectedSectionCandidateFamily: string | null
}

type BusBenchmarkResult = {
  sampleName: string
  status: "success" | "failed"
  durationMs: number
  baseline: ComparableStats
  current: ComparableStats | null
  scoreMatches: boolean
  error: string | null
}

const HELP_TEXT = `Usage: ./benchmark-bus.sh [options]

Run the srj12 bus-routing dataset benchmark and compare deterministic score
fields against the baselines baked into the dataset package.

Options:
  --limit N       Run the first N samples from the dataset.
  --sample NUM    Run a specific sample by number or name (e.g. 2, 002, sample002).
  --strict        Exit non-zero if any sample fails or any score differs.
  --help          Show this help text.

Examples:
  ./benchmark-bus.sh
  ./benchmark-bus.sh --limit 3
  ./benchmark-bus.sh --sample sample003
  ./benchmark-bus.sh --strict
`

const SCORE_EPSILON = 1e-9

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

  return { limit, sampleName, strict }
}

const formatSeconds = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`

const formatMetric = (value: number | null, digits = 6) =>
  value === null ? "n/a" : value.toFixed(digits)

const formatPercent = (numerator: number, denominator: number) =>
  `${((numerator / Math.max(denominator, 1)) * 100).toFixed(1)}%`

const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length

const getNumberStat = (
  stats: Record<string, unknown>,
  key: keyof ComparableStats,
) => {
  const value = stats[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const getStringStat = (
  stats: Record<string, unknown>,
  key: keyof ComparableStats,
) => {
  const value = stats[key]
  return typeof value === "string" ? value : null
}

const getComparableStats = (
  stats: Record<string, unknown>,
): ComparableStats => ({
  sectionSearchGeneratedCandidateCount: getNumberStat(
    stats,
    "sectionSearchGeneratedCandidateCount",
  ),
  sectionSearchCandidateCount: getNumberStat(
    stats,
    "sectionSearchCandidateCount",
  ),
  sectionSearchDuplicateCandidateCount: getNumberStat(
    stats,
    "sectionSearchDuplicateCandidateCount",
  ),
  sectionSearchBaselineMaxRegionCost: getNumberStat(
    stats,
    "sectionSearchBaselineMaxRegionCost",
  ),
  sectionSearchFinalMaxRegionCost: getNumberStat(
    stats,
    "sectionSearchFinalMaxRegionCost",
  ),
  sectionSearchDelta: getNumberStat(stats, "sectionSearchDelta"),
  selectedSectionCandidateLabel: getStringStat(
    stats,
    "selectedSectionCandidateLabel",
  ),
  selectedSectionCandidateFamily: getStringStat(
    stats,
    "selectedSectionCandidateFamily",
  ),
})

const numbersMatch = (left: number | null, right: number | null) => {
  if (left === null || right === null) return left === right
  return Math.abs(left - right) <= SCORE_EPSILON
}

const comparableStatsMatch = (left: ComparableStats, right: ComparableStats) =>
  numbersMatch(
    left.sectionSearchGeneratedCandidateCount,
    right.sectionSearchGeneratedCandidateCount,
  ) &&
  numbersMatch(
    left.sectionSearchCandidateCount,
    right.sectionSearchCandidateCount,
  ) &&
  numbersMatch(
    left.sectionSearchDuplicateCandidateCount,
    right.sectionSearchDuplicateCandidateCount,
  ) &&
  numbersMatch(
    left.sectionSearchBaselineMaxRegionCost,
    right.sectionSearchBaselineMaxRegionCost,
  ) &&
  numbersMatch(
    left.sectionSearchFinalMaxRegionCost,
    right.sectionSearchFinalMaxRegionCost,
  ) &&
  numbersMatch(left.sectionSearchDelta, right.sectionSearchDelta) &&
  left.selectedSectionCandidateLabel === right.selectedSectionCandidateLabel &&
  left.selectedSectionCandidateFamily === right.selectedSectionCandidateFamily

const getSelectedSamples = (
  samples: BusBenchmarkSample[],
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

const runSample = (sample: BusBenchmarkSample): BusBenchmarkResult => {
  const startTime = performance.now()
  const benchmarkCase = sample.tinyHypergraphBenchmark
  const baseline = getComparableStats(benchmarkCase.stats)

  try {
    const solver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: normalizeSerializedHyperGraph(benchmarkCase),
    })
    solver.solve()

    if (solver.failed) {
      throw new Error(
        solver.error ?? "section pipeline solver failed unexpectedly",
      )
    }

    const current = getComparableStats(solver.stats)

    return {
      sampleName: sample.sampleName,
      status: "success",
      durationMs: performance.now() - startTime,
      baseline,
      current,
      scoreMatches: comparableStatsMatch(current, baseline),
      error: null,
    }
  } catch (error) {
    return {
      sampleName: sample.sampleName,
      status: "failed",
      durationMs: performance.now() - startTime,
      baseline,
      current: null,
      scoreMatches: false,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    }
  }
}

const main = () => {
  const { limit, sampleName, strict } = parseArgs()
  const allSamples = busDatasetSamples as BusBenchmarkSample[]
  const selectedSamples = getSelectedSamples(allSamples, limit, sampleName)
  const results: BusBenchmarkResult[] = []

  console.log(
    `dataset=srj12-bus-routing samples=${selectedSamples.length}/${allSamples.length}`,
  )

  for (const sample of selectedSamples) {
    const result = runSample(sample)
    results.push(result)

    const current = result.current
    console.log(
      [
        result.sampleName.padEnd(9),
        result.status.padEnd(7),
        `scoreMatch=${result.scoreMatches ? "yes" : "no"}`,
        `bakedBaseline=${formatMetric(result.baseline.sectionSearchBaselineMaxRegionCost)}`,
        `currentBaseline=${formatMetric(current?.sectionSearchBaselineMaxRegionCost ?? null)}`,
        `bakedFinal=${formatMetric(result.baseline.sectionSearchFinalMaxRegionCost)}`,
        `currentFinal=${formatMetric(current?.sectionSearchFinalMaxRegionCost ?? null)}`,
        `bakedDelta=${formatMetric(result.baseline.sectionSearchDelta)}`,
        `currentDelta=${formatMetric(current?.sectionSearchDelta ?? null)}`,
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
  const scoreMatchCount = results.filter((result) => result.scoreMatches).length
  const durations = results.map((result) => result.durationMs)
  const bakedFinalCosts = results
    .map((result) => result.baseline.sectionSearchFinalMaxRegionCost)
    .filter((value): value is number => value !== null)
  const currentFinalCosts = successfulResults
    .map((result) => result.current?.sectionSearchFinalMaxRegionCost ?? null)
    .filter((value): value is number => value !== null)

  console.log(
    `success rate: ${formatPercent(successfulResults.length, results.length)}`,
  )
  console.log(
    `score recreation rate: ${formatPercent(scoreMatchCount, results.length)}`,
  )
  console.log(`avg baked final cost: ${formatMetric(average(bakedFinalCosts))}`)
  console.log(
    `avg current final cost: ${formatMetric(average(currentFinalCosts))}`,
  )
  console.log(`avg duration: ${formatSeconds(average(durations))}`)

  if (
    strict &&
    (successfulResults.length !== results.length ||
      scoreMatchCount !== results.length)
  ) {
    process.exit(1)
  }
}

main()
