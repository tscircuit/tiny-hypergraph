import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/index"

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

type ProfileRow = {
  sample: string
  circuit: string
  ms: number
  iterations: number
  ripsUsed: number
  datasetMaxRegionCost: number
  tinyMaxRegionCost: number
  avgNonZeroRegionCost: number
  referenceSteps: number
  solved: boolean
}

type SkippedSample = {
  sample: string
  circuit: string
  error: string
}

type CliOptions = {
  sampleCount: number
  congestionFalloff?: number
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

const getAvgNonZeroRegionCost = (solver: TinyHyperGraphSolver) => {
  let nonZeroRegionCount = 0
  let totalNonZeroRegionCost = 0

  for (const regionCache of solver.state.regionIntersectionCaches) {
    if (regionCache.existingRegionCost <= 0) continue
    nonZeroRegionCount += 1
    totalNonZeroRegionCost += regionCache.existingRegionCost
  }

  if (nonZeroRegionCount === 0) {
    return 0
  }

  return totalNonZeroRegionCost / nonZeroRegionCount
}

const computeDatasetMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const replaySolver = new TinyHyperGraphSolver(topology, problem)
  const regionIdToIndex = new Map<string, number>()
  const portIdToIndex = new Map<string, number>()
  const solvedRouteByConnectionId = new Map(
    (serializedHyperGraph.solvedRoutes ?? []).map((solvedRoute) => [
      solvedRoute.connection.connectionId,
      solvedRoute,
    ]),
  )

  topology.regionMetadata?.forEach((metadata, regionIndex) => {
    const serializedRegionId = metadata?.serializedRegionId
    if (typeof serializedRegionId === "string") {
      regionIdToIndex.set(serializedRegionId, regionIndex)
    }
  })

  topology.portMetadata?.forEach((metadata, portIndex) => {
    const serializedPortId = metadata?.serializedPortId
    if (typeof serializedPortId === "string") {
      portIdToIndex.set(serializedPortId, portIndex)
    }
  })

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const connectionId = problem.routeMetadata?.[routeId]?.connectionId
    if (typeof connectionId !== "string") {
      continue
    }

    const solvedRoute = solvedRouteByConnectionId.get(connectionId)
    if (!solvedRoute) {
      continue
    }

    replaySolver.state.currentRouteNetId = problem.routeNet[routeId]

    for (let stepIndex = 1; stepIndex < solvedRoute.path.length; stepIndex++) {
      const previousStep = solvedRoute.path[stepIndex - 1]
      const currentStep = solvedRoute.path[stepIndex]
      const fromPortId = previousStep?.portId
      const toPortId = currentStep?.portId
      const regionId =
        currentStep?.lastRegionId ?? previousStep?.nextRegionId ?? undefined

      if (
        typeof fromPortId !== "string" ||
        typeof toPortId !== "string" ||
        typeof regionId !== "string"
      ) {
        continue
      }

      const fromPortIndex = portIdToIndex.get(fromPortId)
      const toPortIndex = portIdToIndex.get(toPortId)
      const regionIndex = regionIdToIndex.get(regionId)

      if (
        fromPortIndex === undefined ||
        toPortIndex === undefined ||
        regionIndex === undefined
      ) {
        continue
      }

      replaySolver.appendSegmentToRegionCache(
        regionIndex,
        fromPortIndex,
        toPortIndex,
      )
    }
  }

  replaySolver.state.currentRouteNetId = undefined
  return getMaxRegionCost(replaySolver)
}

const parseCliOptions = (argv: string[]): CliOptions => {
  let sampleCount = 10
  let congestionFalloff: number | undefined

  for (let argIndex = 0; argIndex < argv.length; argIndex++) {
    const arg = argv[argIndex]
    if (arg === "--sample-count") {
      const nextArg = argv[argIndex + 1]
      const parsedValue = Number.parseInt(nextArg ?? "", 10)
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        throw new Error("--sample-count must be a positive integer")
      }
      sampleCount = parsedValue
      argIndex += 1
      continue
    }

    if (arg.startsWith("--sample-count=")) {
      const parsedValue = Number.parseInt(arg.split("=")[1] ?? "", 10)
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        throw new Error("--sample-count must be a positive integer")
      }
      sampleCount = parsedValue
      continue
    }

    if (arg === "--congestion-falloff") {
      const nextArg = argv[argIndex + 1]
      const parsedValue = Number.parseFloat(nextArg ?? "")
      if (!Number.isFinite(parsedValue)) {
        throw new Error("--congestion-falloff must be a finite number")
      }
      congestionFalloff = parsedValue
      argIndex += 1
      continue
    }

    if (arg.startsWith("--congestion-falloff=")) {
      const parsedValue = Number.parseFloat(arg.split("=")[1] ?? "")
      if (!Number.isFinite(parsedValue)) {
        throw new Error("--congestion-falloff must be a finite number")
      }
      congestionFalloff = parsedValue
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    sampleCount,
    congestionFalloff,
  }
}

const datasetModule = datasetHg07 as DatasetModule
const cliOptions = parseCliOptions(process.argv.slice(2))
const requestedSampleCount = cliOptions.sampleCount
const sampleMetas = datasetModule.manifest.samples.slice(
  0,
  requestedSampleCount,
)

const rows: ProfileRow[] = []
const skippedSamples: SkippedSample[] = []
let totalMs = 0
let totalIterations = 0
let totalRipsUsed = 0
let totalReferenceSteps = 0
let maxDatasetRegionCost = 0
let maxTinyRegionCost = 0
let totalAvgNonZeroRegionCost = 0
let failedSampleCount = 0

for (const sampleMeta of sampleMetas) {
  try {
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph
    const datasetMaxRegionCost =
      computeDatasetMaxRegionCost(serializedHyperGraph)
    const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
    if (cliOptions.congestionFalloff !== undefined) {
      problem.congestionFalloff = cliOptions.congestionFalloff
    }
    const solver = new TinyHyperGraphSolver(topology, problem)

    const startTime = performance.now()
    solver.solve()
    const elapsedMs = performance.now() - startTime
    const tinyMaxRegionCost = getMaxRegionCost(solver)
    const avgNonZeroRegionCost = getAvgNonZeroRegionCost(solver)

    const row: ProfileRow = {
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      ms: elapsedMs,
      iterations: solver.iterations,
      ripsUsed: solver.state.ripCount,
      datasetMaxRegionCost,
      tinyMaxRegionCost,
      avgNonZeroRegionCost,
      referenceSteps: sampleMeta.stepsToPortPointSolve,
      solved: solver.solved && !solver.failed,
    }

    rows.push(row)
    totalMs += elapsedMs
    totalIterations += row.iterations
    totalRipsUsed += row.ripsUsed
    totalReferenceSteps += row.referenceSteps
    totalAvgNonZeroRegionCost += row.avgNonZeroRegionCost
    maxDatasetRegionCost = Math.max(
      maxDatasetRegionCost,
      row.datasetMaxRegionCost,
    )
    maxTinyRegionCost = Math.max(maxTinyRegionCost, row.tinyMaxRegionCost)

    if (!row.solved) {
      failedSampleCount += 1
    }
  } catch (error) {
    skippedSamples.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const roundedRows = rows.map((row) => ({
  sample: row.sample,
  circuit: row.circuit,
  ms: Number(row.ms.toFixed(2)),
  iterations: row.iterations,
  ripsUsed: row.ripsUsed,
  datasetMaxRegionCost: Number(row.datasetMaxRegionCost.toFixed(3)),
  tinyMaxRegionCost: Number(row.tinyMaxRegionCost.toFixed(3)),
  avgNonZeroRegionCost: Number(row.avgNonZeroRegionCost.toFixed(3)),
  referenceSteps: row.referenceSteps,
  solved: row.solved,
}))

console.log("hg-07 solve profile")
console.log(
  `requestedSamples=${requestedSampleCount} consideredSamples=${sampleMetas.length} includedSamples=${rows.length} skippedSamples=${skippedSamples.length} failed=${failedSampleCount} congestionFalloff=${cliOptions.congestionFalloff ?? "default"}`,
)
console.table(roundedRows)
if (skippedSamples.length > 0) {
  console.log(
    `skipped sample ids: ${skippedSamples.map((sample) => sample.sample).join(", ")}`,
  )
}
console.log(
  JSON.stringify(
    {
      requestedSampleCount,
      consideredSampleCount: sampleMetas.length,
      includedSampleCount: rows.length,
      skippedSampleCount: skippedSamples.length,
      skippedSampleNames: skippedSamples.map((sample) => sample.sample),
      congestionFalloff:
        cliOptions.congestionFalloff === undefined
          ? "default"
          : cliOptions.congestionFalloff,
      totalMs: Number(totalMs.toFixed(2)),
      averageMs: Number((totalMs / Math.max(rows.length, 1)).toFixed(2)),
      totalIterations,
      averageIterations: Number(
        (totalIterations / Math.max(rows.length, 1)).toFixed(1),
      ),
      totalRipsUsed,
      averageRipsUsed: Number(
        (totalRipsUsed / Math.max(rows.length, 1)).toFixed(1),
      ),
      totalReferenceSteps,
      averageAvgNonZeroRegionCost: Number(
        (totalAvgNonZeroRegionCost / Math.max(rows.length, 1)).toFixed(3),
      ),
      maxDatasetRegionCost: Number(maxDatasetRegionCost.toFixed(3)),
      maxTinyRegionCost: Number(maxTinyRegionCost.toFixed(3)),
    },
    null,
    2,
  ),
)
