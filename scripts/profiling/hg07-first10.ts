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
  referenceSteps: number
  solved: boolean
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

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

const datasetModule = datasetHg07 as DatasetModule
const sampleMetas = datasetModule.manifest.samples.slice(0, 10)

const rows: ProfileRow[] = []
let totalMs = 0
let totalIterations = 0
let totalRipsUsed = 0
let totalReferenceSteps = 0
let maxDatasetRegionCost = 0
let maxTinyRegionCost = 0
let failedSampleCount = 0

for (const sampleMeta of sampleMetas) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph
  const datasetMaxRegionCost = computeDatasetMaxRegionCost(serializedHyperGraph)
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new TinyHyperGraphSolver(topology, problem)

  const startTime = performance.now()
  solver.solve()
  const elapsedMs = performance.now() - startTime
  const tinyMaxRegionCost = getMaxRegionCost(solver)

  const row: ProfileRow = {
    sample: sampleMeta.sampleName,
    circuit: sampleMeta.circuitId,
    ms: elapsedMs,
    iterations: solver.iterations,
    ripsUsed: solver.state.ripCount,
    datasetMaxRegionCost,
    tinyMaxRegionCost,
    referenceSteps: sampleMeta.stepsToPortPointSolve,
    solved: solver.solved && !solver.failed,
  }

  rows.push(row)
  totalMs += elapsedMs
  totalIterations += row.iterations
  totalRipsUsed += row.ripsUsed
  totalReferenceSteps += row.referenceSteps
  maxDatasetRegionCost = Math.max(
    maxDatasetRegionCost,
    row.datasetMaxRegionCost,
  )
  maxTinyRegionCost = Math.max(maxTinyRegionCost, row.tinyMaxRegionCost)

  if (!row.solved) {
    failedSampleCount += 1
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
  referenceSteps: row.referenceSteps,
  solved: row.solved,
}))

console.log("hg-07 first 10 solve profile")
console.log(`samples=${rows.length} failed=${failedSampleCount}`)
console.table(roundedRows)
console.log(
  JSON.stringify(
    {
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
      maxDatasetRegionCost: Number(maxDatasetRegionCost.toFixed(3)),
      maxTinyRegionCost: Number(maxTinyRegionCost.toFixed(3)),
    },
    null,
    2,
  ),
)
