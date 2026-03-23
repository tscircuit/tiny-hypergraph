import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../../lib/index"

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

type SectionMaskCandidate = {
  label: string
  regionIds: number[]
  mode: "any" | "both"
}

type SectionPassResult = {
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  delta: number
  activeRouteCount: number
  outputGraph: SerializedHyperGraph
  winningCandidateLabel?: string
}

type BenchmarkRow = {
  sample: string
  circuit: string
  passesUsed: number
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  delta: number
  activeRouteCount: number
  winningCandidateLabel?: string
  failed?: boolean
  error?: string
}

const datasetModule = datasetHg07 as DatasetModule
const sampleMetas = datasetModule.manifest.samples.slice(0, 40)

const MAX_PASSES = 2
const MAX_HOT_REGIONS = 12
const IMPROVEMENT_EPSILON = 1e-9

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: number[],
) => {
  const adjacentRegionIds = new Set(seedRegionIds)

  for (const seedRegionId of seedRegionIds) {
    for (const portId of topology.regionIncidentPorts[seedRegionId] ?? []) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(regionId)
      }
    }
  }

  return [...adjacentRegionIds]
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: number[],
  mode: "any" | "both",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (mode === "any") {
      return incidentRegionIds.some((regionId) => selectedRegionIds.has(regionId))
        ? 1
        : 0
    }

    return incidentRegionIds.length > 0 &&
      incidentRegionIds.every((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const createProblemWithPortSectionMask = (
  problem: TinyHyperGraphProblem,
  portSectionMask: Int8Array,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask,
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
})

const getSectionMaskCandidates = (
  solver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
): SectionMaskCandidate[] => {
  const hotRegionIds = solver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, MAX_HOT_REGIONS)
    .map(({ regionId }) => regionId)

  const candidates: SectionMaskCandidate[] = []

  for (const hotRegionId of hotRegionIds) {
    const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])
    const twoHopRegionIds = getAdjacentRegionIds(topology, oneHopRegionIds)

    candidates.push(
      {
        label: `hot-${hotRegionId}-self-both`,
        regionIds: [hotRegionId],
        mode: "both",
      },
      {
        label: `hot-${hotRegionId}-self-any`,
        regionIds: [hotRegionId],
        mode: "any",
      },
      {
        label: `hot-${hotRegionId}-onehop-both`,
        regionIds: oneHopRegionIds,
        mode: "both",
      },
      {
        label: `hot-${hotRegionId}-onehop-any`,
        regionIds: oneHopRegionIds,
        mode: "any",
      },
      {
        label: `hot-${hotRegionId}-twohop-both`,
        regionIds: twoHopRegionIds,
        mode: "both",
      },
      {
        label: `hot-${hotRegionId}-twohop-any`,
        regionIds: twoHopRegionIds,
        mode: "any",
      },
    )
  }

  return candidates
}

const runBestSectionOptimizationPass = (
  serializedHyperGraph: SerializedHyperGraph,
): SectionPassResult => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solveGraphSolver = new TinyHyperGraphSolver(topology, problem)
  solveGraphSolver.solve()

  const solvedGraph = solveGraphSolver.getOutput()
  const replay = loadSerializedHyperGraph(solvedGraph)
  const baselineSectionSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )
  const baselineMaxRegionCost = getMaxRegionCost(baselineSectionSolver.baselineSolver)

  let bestFinalMaxRegionCost = baselineMaxRegionCost
  let bestSolver: TinyHyperGraphSectionSolver | undefined
  let winningCandidateLabel: string | undefined

  for (const candidate of getSectionMaskCandidates(
    solveGraphSolver,
    replay.topology,
  )) {
    try {
      const sectionSolver = new TinyHyperGraphSectionSolver(
        replay.topology,
        createProblemWithPortSectionMask(
          replay.problem,
          createPortSectionMaskForRegionIds(
            replay.topology,
            candidate.regionIds,
            candidate.mode,
          ),
        ),
        replay.solution,
      )

      sectionSolver.solve()
      const finalMaxRegionCost = getMaxRegionCost(sectionSolver.getSolvedSolver())

      if (finalMaxRegionCost < bestFinalMaxRegionCost - IMPROVEMENT_EPSILON) {
        bestFinalMaxRegionCost = finalMaxRegionCost
        bestSolver = sectionSolver
        winningCandidateLabel = candidate.label
      }
    } catch {
      // Ignore masks that cannot produce a valid single section span.
    }
  }

  return {
    baselineMaxRegionCost,
    finalMaxRegionCost: bestFinalMaxRegionCost,
    delta: baselineMaxRegionCost - bestFinalMaxRegionCost,
    activeRouteCount: bestSolver?.activeRouteIds.length ?? 0,
    outputGraph: bestSolver ? bestSolver.getOutput() : solvedGraph,
    winningCandidateLabel,
  }
}

const benchmarkRows: BenchmarkRow[] = []
let improvedSampleCount = 0
let unchangedSampleCount = 0
let failedSampleCount = 0
let totalDelta = 0
let totalPassesUsed = 0
const benchmarkStartTime = performance.now()

for (const sampleMeta of sampleMetas) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph

  try {
    let currentGraph = serializedHyperGraph
    let baselineMaxRegionCost = 0
    let finalMaxRegionCost = 0
    let activeRouteCount = 0
    let winningCandidateLabel: string | undefined
    let passesUsed = 0

    for (let passIndex = 0; passIndex < MAX_PASSES; passIndex++) {
      const passResult = runBestSectionOptimizationPass(currentGraph)

      if (passIndex === 0) {
        baselineMaxRegionCost = passResult.baselineMaxRegionCost
      }

      finalMaxRegionCost = passResult.finalMaxRegionCost
      activeRouteCount = passResult.activeRouteCount
      winningCandidateLabel = passResult.winningCandidateLabel
      passesUsed = passIndex + 1

      if (passResult.delta <= IMPROVEMENT_EPSILON) {
        break
      }

      currentGraph = passResult.outputGraph
    }

    const delta = baselineMaxRegionCost - finalMaxRegionCost
    totalDelta += delta
    totalPassesUsed += passesUsed

    if (delta > IMPROVEMENT_EPSILON) {
      improvedSampleCount += 1
    } else {
      unchangedSampleCount += 1
    }

    benchmarkRows.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      passesUsed,
      baselineMaxRegionCost,
      finalMaxRegionCost,
      delta,
      activeRouteCount,
      winningCandidateLabel,
    })
  } catch (error) {
    failedSampleCount += 1
    benchmarkRows.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      passesUsed: 0,
      baselineMaxRegionCost: Number.NaN,
      finalMaxRegionCost: Number.NaN,
      delta: Number.NaN,
      activeRouteCount: 0,
      failed: true,
      error: String(error),
    })
  }
}

const benchmarkElapsedMs = performance.now() - benchmarkStartTime
const roundedRows = benchmarkRows.map((row) => ({
  sample: row.sample,
  circuit: row.circuit,
  passesUsed: row.passesUsed,
  baselineMaxRegionCost: Number.isFinite(row.baselineMaxRegionCost)
    ? Number(row.baselineMaxRegionCost.toFixed(3))
    : null,
  finalMaxRegionCost: Number.isFinite(row.finalMaxRegionCost)
    ? Number(row.finalMaxRegionCost.toFixed(3))
    : null,
  delta: Number.isFinite(row.delta) ? Number(row.delta.toFixed(3)) : null,
  activeRouteCount: row.activeRouteCount,
  winningCandidateLabel: row.winningCandidateLabel ?? null,
  failed: row.failed ?? false,
  error: row.error ?? null,
}))

const topImprovedRows = benchmarkRows
  .filter((row) => Number.isFinite(row.delta) && row.delta > IMPROVEMENT_EPSILON)
  .sort((left, right) => right.delta - left.delta)
  .slice(0, 10)
  .map((row) => ({
    sample: row.sample,
    circuit: row.circuit,
    delta: Number(row.delta.toFixed(3)),
    baselineMaxRegionCost: Number(row.baselineMaxRegionCost.toFixed(3)),
    finalMaxRegionCost: Number(row.finalMaxRegionCost.toFixed(3)),
    activeRouteCount: row.activeRouteCount,
    winningCandidateLabel: row.winningCandidateLabel ?? null,
  }))

console.log("hg-07 first 40 repeated section pipeline benchmark")
console.log(
  `samples=${benchmarkRows.length} improved=${improvedSampleCount} unchanged=${unchangedSampleCount} failed=${failedSampleCount}`,
)
console.table(roundedRows)
console.log("top improvements")
console.table(topImprovedRows)
console.log(
  JSON.stringify(
    {
      samples: benchmarkRows.length,
      improvedSampleCount,
      unchangedSampleCount,
      failedSampleCount,
      totalDelta: Number(totalDelta.toFixed(3)),
      averageDeltaAcrossAllSamples: Number(
        (totalDelta / Math.max(benchmarkRows.length - failedSampleCount, 1)).toFixed(
          3,
        ),
      ),
      averagePassesUsed: Number(
        (totalPassesUsed / Math.max(benchmarkRows.length - failedSampleCount, 1)).toFixed(
          2,
        ),
      ),
      elapsedMs: Number(benchmarkElapsedMs.toFixed(2)),
    },
    null,
    2,
  ),
)
