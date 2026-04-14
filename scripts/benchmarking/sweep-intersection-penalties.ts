import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "../../lib/index"

type DatasetSampleMeta = {
  sampleName: string
  circuitId: string
}

type DatasetModule = Record<string, unknown> & {
  manifest: {
    sampleCount: number
    samples: DatasetSampleMeta[]
  }
}

type BenchmarkSummary = {
  label: string
  solverOptions: TinyHyperGraphSolverOptions
  sampleCount: number
  successCount: number
  improvedCount: number
  zeroFinalCostCount: number
  failedCount: number
  avgBaselineMaxRegionCost: number
  avgFinalMaxRegionCost: number
  avgDelta: number
  avgDurationMs: number
  elapsedMs: number
}

const datasetModule = datasetHg07 as DatasetModule
const IMPROVEMENT_EPSILON = 1e-9

const HELP_TEXT = `Usage: bun run scripts/benchmarking/sweep-intersection-penalties.ts [options]

Grid-search penalty-point parameters against the section pipeline benchmark.

Options:
  --limit N            Run the first N samples from the dataset.
  --sample NUM         Run a specific sample by number or name.
  --radii CSV          Penalty radii to evaluate. Default: 0.5,0.8,1.1,1.4
  --falloffs CSV       Penalty falloff exponents. Default: 0.75,1,1.5,2
  --magnitudes CSV     Penalty magnitudes. Default: 0.05,0.1,0.15,0.2,0.3
  --top N              Number of top configs to print. Default: 10
  --help               Show this help text.
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

const parseCsvNumbers = (rawValue: string | undefined, flag: string) => {
  const requiredValue = rawValue ?? usageError(`Missing value for ${flag}`)

  const values = requiredValue
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) {
    usageError(`Invalid ${flag} value: ${requiredValue}`)
  }

  return values
}

const parseArgs = () => {
  let limit: number | null = null
  let sampleName: string | null = null
  let radii = [0.5, 0.8, 1.1, 1.4]
  let falloffs = [0.75, 1, 1.5, 2]
  let magnitudes = [0.05, 0.1, 0.15, 0.2, 0.3]
  let top = 10

  for (let index = 2; index < process.argv.length; index += 1) {
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
      sampleName = formatSampleName(process.argv[index + 1])
      index += 1
      continue
    }

    if (arg === "--radii") {
      radii = parseCsvNumbers(process.argv[index + 1], "--radii")
      index += 1
      continue
    }

    if (arg === "--falloffs") {
      falloffs = parseCsvNumbers(process.argv[index + 1], "--falloffs")
      index += 1
      continue
    }

    if (arg === "--magnitudes") {
      magnitudes = parseCsvNumbers(process.argv[index + 1], "--magnitudes")
      index += 1
      continue
    }

    if (arg === "--top") {
      const rawValue = process.argv[index + 1]
      const parsedValue = Number(rawValue)

      if (!rawValue || !Number.isFinite(parsedValue) || parsedValue <= 0) {
        usageError(`Invalid --top value: ${rawValue ?? "<missing>"}`)
      }

      top = Math.floor(parsedValue)
      index += 1
      continue
    }

    usageError(`Unknown option: ${arg}`)
  }

  if (limit !== null && sampleName !== null) {
    usageError("Use either --limit or --sample, not both")
  }

  return {
    limit,
    sampleName,
    radii,
    falloffs,
    magnitudes,
    top,
  }
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

const getSelectedSamples = (
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

const runPipelineBenchmark = async (
  sampleMetas: DatasetSampleMeta[],
  label: string,
  solverOptions: TinyHyperGraphSolverOptions,
): Promise<BenchmarkSummary> => {
  const startTime = performance.now()
  let successCount = 0
  let improvedCount = 0
  let zeroFinalCostCount = 0
  const baselineCosts: number[] = []
  const finalCosts: number[] = []
  const deltas: number[] = []
  const durations: number[] = []

  for (const sampleMeta of sampleMetas) {
    const sampleStartTime = performance.now()
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
        serializedHyperGraph,
        sectionSolverOptions: solverOptions,
      })
      pipelineSolver.solve()

      if (pipelineSolver.failed) {
        throw new Error(pipelineSolver.error ?? "pipeline solver failed")
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

      successCount += 1
      improvedCount += delta > IMPROVEMENT_EPSILON ? 1 : 0
      zeroFinalCostCount += finalMaxRegionCost <= IMPROVEMENT_EPSILON ? 1 : 0
      baselineCosts.push(baselineMaxRegionCost)
      finalCosts.push(finalMaxRegionCost)
      deltas.push(delta)
      durations.push(performance.now() - sampleStartTime)
    } catch {
      durations.push(performance.now() - sampleStartTime)
    }
  }

  return {
    label,
    solverOptions,
    sampleCount: sampleMetas.length,
    successCount,
    improvedCount,
    zeroFinalCostCount,
    failedCount: sampleMetas.length - successCount,
    avgBaselineMaxRegionCost: average(baselineCosts),
    avgFinalMaxRegionCost: average(finalCosts),
    avgDelta: average(deltas),
    avgDurationMs: average(durations),
    elapsedMs: performance.now() - startTime,
  }
}

const compareSummaries = (left: BenchmarkSummary, right: BenchmarkSummary) => {
  if (left.avgDelta !== right.avgDelta) {
    return right.avgDelta - left.avgDelta
  }

  if (left.improvedCount !== right.improvedCount) {
    return right.improvedCount - left.improvedCount
  }

  if (left.avgFinalMaxRegionCost !== right.avgFinalMaxRegionCost) {
    return left.avgFinalMaxRegionCost - right.avgFinalMaxRegionCost
  }

  return left.avgDurationMs - right.avgDurationMs
}

const main = async () => {
  const { limit, sampleName, radii, falloffs, magnitudes, top } = parseArgs()
  const sampleMetas = getSelectedSamples(limit, sampleName)

  const baseline = await runPipelineBenchmark(sampleMetas, "baseline-region", {
    RIP_CONGESTION_MODE: "region",
    RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  })

  const candidateSummaries: BenchmarkSummary[] = []

  for (const radius of radii) {
    for (const falloff of falloffs) {
      for (const magnitude of magnitudes) {
        const label = `point-r${radius}-f${falloff}-m${magnitude}`
        candidateSummaries.push(
          await runPipelineBenchmark(sampleMetas, label, {
            RIP_CONGESTION_MODE: "penalty-points",
            INTERSECTION_PENALTY_POINT_RADIUS: radius,
            INTERSECTION_PENALTY_POINT_FALLOFF: falloff,
            INTERSECTION_PENALTY_POINT_MAGNITUDE: magnitude,
          }),
        )
      }
    }
  }

  const topCandidates = candidateSummaries.sort(compareSummaries).slice(0, top)
  const bestCandidate = topCandidates[0]

  console.log(
    JSON.stringify(
      {
        sampleCount: sampleMetas.length,
        baseline,
        bestCandidate,
        improvementVsBaseline: bestCandidate
          ? {
              avgDelta: bestCandidate.avgDelta - baseline.avgDelta,
              avgFinalMaxRegionCost:
                baseline.avgFinalMaxRegionCost -
                bestCandidate.avgFinalMaxRegionCost,
              improvedSamples:
                bestCandidate.improvedCount - baseline.improvedCount,
              zeroFinalCostSamples:
                bestCandidate.zeroFinalCostCount - baseline.zeroFinalCostCount,
            }
          : null,
        topCandidates,
      },
      null,
      2,
    ),
  )
}

await main()
