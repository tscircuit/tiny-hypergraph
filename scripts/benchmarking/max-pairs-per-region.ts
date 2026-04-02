import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "../../lib/index"
import type { RegionId } from "../../lib/types"

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

type ReplaySegment = {
  routeNet: number
  regionId: RegionId
  fromPortId: number
  toPortId: number
}

type LoadedSample = {
  sample: string
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  replaySegments: ReplaySegment[]
}

type LoadedSamplesResult = {
  samples: LoadedSample[]
  skippedSamples: string[]
}

type BenchmarkSummary = {
  label: string
  avgMs: number
  avgIterations: number
  avgRips: number
  avgMaxRegionCost: number
  avgMaxPairCount: number
  maxObservedPairCount: number
  runsWithMaxPairCountOver16: number
  failedRuns: number
  successfulRuns: number
}

const datasetModule = datasetHg07 as DatasetModule

const parsePositiveIntegerArg = (flag: string, fallback: number) => {
  const argIndex = process.argv.findIndex((arg) => arg === flag)
  if (argIndex === -1) {
    return fallback
  }

  const rawValue = process.argv[argIndex + 1]
  const parsedValue = Number(rawValue)
  if (!rawValue || !Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid ${flag} value: ${rawValue ?? "<missing>"}`)
  }

  return parsedValue
}

const parseTierArgs = () => {
  const tiersIndex = process.argv.findIndex((arg) => arg === "--tiers")
  const rawValue =
    tiersIndex === -1 ? "4,16,64" : process.argv[tiersIndex + 1] ?? ""

  if (!rawValue) {
    throw new Error("Missing --tiers value")
  }

  return rawValue.split(",").map((value) => {
    const parsedValue = Number(value.trim())
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new Error(`Invalid tier value: ${value}`)
    }
    return parsedValue
  })
}

const formatMs = (value: number) => `${value.toFixed(2)}ms`
const round = (value: number, digits = 3) => Number(value.toFixed(digits))

const getSharedRegionIdForPorts = (
  topology: TinyHyperGraphTopology,
  fromPortId: number,
  toPortId: number,
) => {
  const fromIncidentRegions = topology.incidentPortRegion[fromPortId] ?? []
  const toIncidentRegions = topology.incidentPortRegion[toPortId] ?? []
  const sharedRegionId = fromIncidentRegions.find((regionId) =>
    toIncidentRegions.includes(regionId),
  )

  if (sharedRegionId === undefined) {
    throw new Error(`Ports ${fromPortId} and ${toPortId} do not share a region`)
  }

  return sharedRegionId
}

const buildReplaySegments = (
  serializedHyperGraph: SerializedHyperGraph,
): LoadedSample["replaySegments"] => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    serializedHyperGraph,
  )
  const replaySegments: ReplaySegment[] = []

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeSegments = solution.solvedRoutePathSegments[routeId] ?? []
    const routeSegmentRegionIds = solution.solvedRoutePathRegionIds?.[routeId] ?? []

    for (let segmentIndex = 0; segmentIndex < routeSegments.length; segmentIndex++) {
      const [fromPortId, toPortId] = routeSegments[segmentIndex]!
      replaySegments.push({
        routeNet: problem.routeNet[routeId]!,
        regionId:
          routeSegmentRegionIds[segmentIndex] ??
          getSharedRegionIdForPorts(topology, fromPortId, toPortId),
        fromPortId,
        toPortId,
      })
    }
  }

  return replaySegments
}

const loadSamples = (limit: number): LoadedSamplesResult => {
  const samples: LoadedSample[] = []
  const skippedSamples: string[] = []

  for (const sampleMeta of datasetModule.manifest.samples.slice(0, limit)) {
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      const { topology, problem } =
        loadSerializedHyperGraph(serializedHyperGraph)
      samples.push({
        sample: sampleMeta.sampleName,
        topology,
        problem,
        replaySegments: buildReplaySegments(serializedHyperGraph),
      })
    } catch {
      skippedSamples.push(sampleMeta.sampleName)
    }
  }

  return {
    samples,
    skippedSamples,
  }
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getMaxPairCount = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxPairCount, regionIntersectionCache) =>
      Math.max(maxPairCount, regionIntersectionCache.pairCount),
    0,
  )

const replayCommittedSegments = (
  solver: TinyHyperGraphSolver,
  replaySegments: ReplaySegment[],
) => {
  for (const replaySegment of replaySegments) {
    solver.state.currentRouteNetId = replaySegment.routeNet
    solver.appendSegmentToRegionCache(
      replaySegment.regionId,
      replaySegment.fromPortId,
      replaySegment.toPortId,
    )
  }
  solver.state.currentRouteNetId = undefined
}

const benchmarkSolve = (
  samples: LoadedSample[],
  label: string,
  options: TinyHyperGraphSolverOptions,
  repeatCount: number,
): BenchmarkSummary => {
  let totalMs = 0
  let totalIterations = 0
  let totalRips = 0
  let totalMaxRegionCost = 0
  let totalMaxPairCount = 0
  let maxObservedPairCount = 0
  let runsWithMaxPairCountOver16 = 0
  let failedRuns = 0
  let successfulRuns = 0

  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
    for (const sample of samples) {
      const solver = new TinyHyperGraphSolver(sample.topology, sample.problem, options)
      const startTime = performance.now()

      try {
        solver.solve()
      } catch {
        totalMs += performance.now() - startTime
        failedRuns += 1
        continue
      }

      totalMs += performance.now() - startTime

      if (solver.failed || !solver.solved) {
        failedRuns += 1
        continue
      }

      const maxPairCount = getMaxPairCount(solver)
      successfulRuns += 1
      totalIterations += solver.iterations
      totalRips += solver.state.ripCount
      totalMaxRegionCost += getMaxRegionCost(solver)
      totalMaxPairCount += maxPairCount
      maxObservedPairCount = Math.max(maxObservedPairCount, maxPairCount)
      if (maxPairCount > 16) {
        runsWithMaxPairCountOver16 += 1
      }
    }
  }

  const runCount = samples.length * repeatCount
  const successfulRunCount = Math.max(successfulRuns, 1)

  return {
    label,
    avgMs: totalMs / runCount,
    avgIterations: totalIterations / successfulRunCount,
    avgRips: totalRips / successfulRunCount,
    avgMaxRegionCost: totalMaxRegionCost / successfulRunCount,
    avgMaxPairCount: totalMaxPairCount / successfulRunCount,
    maxObservedPairCount,
    runsWithMaxPairCountOver16,
    failedRuns,
    successfulRuns,
  }
}

const benchmarkReplay = (
  samples: LoadedSample[],
  label: string,
  options: TinyHyperGraphSolverOptions,
  repeatCount: number,
): BenchmarkSummary => {
  let totalMs = 0
  let totalMaxRegionCost = 0
  let totalMaxPairCount = 0
  let maxObservedPairCount = 0
  let runsWithMaxPairCountOver16 = 0
  let failedRuns = 0
  let successfulRuns = 0

  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
    for (const sample of samples) {
      const solver = new TinyHyperGraphSolver(sample.topology, sample.problem, options)
      const startTime = performance.now()

      try {
        replayCommittedSegments(solver, sample.replaySegments)
      } catch {
        totalMs += performance.now() - startTime
        failedRuns += 1
        continue
      }

      const maxPairCount = getMaxPairCount(solver)
      totalMs += performance.now() - startTime
      successfulRuns += 1
      totalMaxRegionCost += getMaxRegionCost(solver)
      totalMaxPairCount += maxPairCount
      maxObservedPairCount = Math.max(maxObservedPairCount, maxPairCount)
      if (maxPairCount > 16) {
        runsWithMaxPairCountOver16 += 1
      }
    }
  }

  const runCount = samples.length * repeatCount
  const successfulRunCount = Math.max(successfulRuns, 1)

  return {
    label,
    avgMs: totalMs / runCount,
    avgIterations: 0,
    avgRips: 0,
    avgMaxRegionCost: totalMaxRegionCost / successfulRunCount,
    avgMaxPairCount: totalMaxPairCount / successfulRunCount,
    maxObservedPairCount,
    runsWithMaxPairCountOver16,
    failedRuns,
    successfulRuns,
  }
}

const formatRows = (
  rows: BenchmarkSummary[],
  baseline: BenchmarkSummary,
  includeSolveFields: boolean,
) =>
  rows.map((row) => ({
    label: row.label,
    avgMs: formatMs(row.avgMs),
    speedupVsExact: `${(baseline.avgMs / row.avgMs).toFixed(2)}x`,
    avgIterations: includeSolveFields ? round(row.avgIterations, 1) : undefined,
    avgRips: includeSolveFields ? round(row.avgRips, 1) : undefined,
    avgMaxRegionCost: round(row.avgMaxRegionCost, 6),
    maxRegionCostDriftVsExact: round(
      row.avgMaxRegionCost - baseline.avgMaxRegionCost,
      6,
    ),
    avgMaxPairCount: round(row.avgMaxPairCount, 1),
    maxObservedPairCount: row.maxObservedPairCount,
    runsWithMaxPairCountOver16: row.runsWithMaxPairCountOver16,
    successfulRuns: row.successfulRuns,
    failedRuns: row.failedRuns,
  }))

const limit = parsePositiveIntegerArg("--limit", 10)
const repeatCount = parsePositiveIntegerArg("--repeat", 5)
const tiers = parseTierArgs()
const { samples, skippedSamples } = loadSamples(limit)

const benchmarkConfigs: Array<{
  label: string
  options: TinyHyperGraphSolverOptions
}> = [
  {
    label: "exact",
    options: {},
  },
  {
    label: `tiered-${tiers.join("-")}`,
    options: {
      REGION_PAIR_CAPACITY_GROWTH_STEPS: tiers,
    },
  },
]

console.log(
  `benchmarking region pair growth on hg07 limit=${limit} loaded=${samples.length} skipped=${skippedSamples.length} repeat=${repeatCount} tiers=${tiers.join(",")}`,
)
if (skippedSamples.length > 0) {
  console.log(`skipped samples: ${skippedSamples.join(", ")}`)
}

const solveRows = benchmarkConfigs.map((config) =>
  benchmarkSolve(samples, config.label, config.options, repeatCount),
)
const replayRows = benchmarkConfigs.map((config) =>
  benchmarkReplay(samples, config.label, config.options, repeatCount),
)

console.log("solve benchmark")
console.table(formatRows(solveRows, solveRows[0]!, true))
console.log("replay benchmark")
console.table(formatRows(replayRows, replayRows[0]!, false))
