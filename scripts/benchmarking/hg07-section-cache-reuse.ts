import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import {
  clearTinyHyperGraphSectionSolverCache,
  getSectionSolverLossyScoreKeyStats,
  getSectionSolverScoreCacheKeyStats,
  getTinyHyperGraphSectionSolverCacheStats,
  setSectionSolverLossyScoreKeyObservationEnabled,
  TinyHyperGraphSectionPipelineSolver,
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

type CapacityProjectionRow = {
  cacheKeys: number
  coveredLookups: number
  projectedWarmHitRate: string
}

const datasetModule = datasetHg07 as DatasetModule

const parseLimitArg = () => {
  const limitIndex = process.argv.findIndex((arg) => arg === "--limit")
  if (limitIndex === -1) {
    return datasetModule.manifest.sampleCount
  }

  const rawLimit = process.argv[limitIndex + 1]
  const parsedLimit = Number(rawLimit)

  if (!rawLimit || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    throw new Error(`Invalid --limit value: ${rawLimit ?? "<missing>"}`)
  }

  return Math.min(Math.floor(parsedLimit), datasetModule.manifest.sampleCount)
}

const parseTargetHitRateArg = () => {
  const targetIndex = process.argv.findIndex((arg) => arg === "--target-hit-rate")
  if (targetIndex === -1) {
    return 0.95
  }

  const rawTarget = process.argv[targetIndex + 1]
  const parsedTarget = Number(rawTarget)

  if (!rawTarget || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
    throw new Error(`Invalid --target-hit-rate value: ${rawTarget ?? "<missing>"}`)
  }

  if (parsedTarget > 1) {
    return parsedTarget / 100
  }

  return parsedTarget
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits))
const formatRate = (value: number) => `${(value * 100).toFixed(1)}%`

const sampleCount = parseLimitArg()
const targetHitRate = parseTargetHitRateArg()
const sampleMetas = datasetModule.manifest.samples.slice(0, sampleCount)

console.log(
  `running hg-07 section cache reuse analysis sampleCount=${sampleCount}/${datasetModule.manifest.sampleCount} targetHitRate=${formatRate(targetHitRate)}`,
)

clearTinyHyperGraphSectionSolverCache()
setSectionSolverLossyScoreKeyObservationEnabled(true)

let failedSamples = 0
const runStartTime = performance.now()

for (const [sampleIndex, sampleMeta] of sampleMetas.entries()) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph

  try {
    const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph,
      sectionSolverOptions: {
        ENABLE_CACHE: true,
      },
    })
    pipelineSolver.solve()

    if (pipelineSolver.failed) {
      throw new Error(pipelineSolver.error ?? "unknown pipeline error")
    }

    const stats = getTinyHyperGraphSectionSolverCacheStats()
    console.log(
      `[${sampleIndex + 1}/${sampleMetas.length}] ${sampleMeta.sampleName} scoreHits=${stats.scoreHits} scoreEntries=${stats.scoreEntries}`,
    )
  } catch (error) {
    failedSamples += 1
    console.log(
      `[${sampleIndex + 1}/${sampleMetas.length}] ${sampleMeta.sampleName} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

const scoreKeyStats = getSectionSolverScoreCacheKeyStats()
const lossyScoreKeyStats = getSectionSolverLossyScoreKeyStats()
const cacheStats = getTinyHyperGraphSectionSolverCacheStats()
const totalLookups = scoreKeyStats.reduce((sum, entry) => sum + entry.lookups, 0)
const repeatedKeyCount = scoreKeyStats.filter((entry) => entry.lookups > 1).length
const singletonKeyCount = scoreKeyStats.filter((entry) => entry.lookups === 1).length
const repeatedLookups = scoreKeyStats.reduce(
  (sum, entry) => sum + (entry.lookups > 1 ? entry.lookups : 0),
  0,
)
const coldSelfWarmHits = scoreKeyStats.reduce(
  (sum, entry) => sum + Math.max(0, entry.lookups - 1),
  0,
)

const sortedByLookups = [...scoreKeyStats].sort(
  (left, right) =>
    right.lookups - left.lookups ||
    right.hits - left.hits ||
    left.key.localeCompare(right.key),
)
const sortedLossyByLookups = [...lossyScoreKeyStats].sort(
  (left, right) =>
    right.lookups - left.lookups ||
    right.distinctScoreKeys - left.distinctScoreKeys ||
    left.key.localeCompare(right.key),
)
const totalLossyLookups = lossyScoreKeyStats.reduce(
  (sum, entry) => sum + entry.lookups,
  0,
)

const projectionCapacities = uniqueSortedNumbers([
  1,
  10,
  25,
  50,
  100,
  250,
  500,
  1000,
  2000,
  sortedByLookups.length,
])

const capacityProjectionRows: CapacityProjectionRow[] = []
let cumulativeLookups = 0
let cursor = 0
let minKeysForTarget = 0

for (const capacity of projectionCapacities) {
  while (cursor < Math.min(capacity, sortedByLookups.length)) {
    cumulativeLookups += sortedByLookups[cursor]?.lookups ?? 0
    cursor += 1
  }

  capacityProjectionRows.push({
    cacheKeys: capacity,
    coveredLookups: cumulativeLookups,
    projectedWarmHitRate:
      totalLookups > 0 ? formatRate(cumulativeLookups / totalLookups) : "0.0%",
  })
}

cumulativeLookups = 0
for (let index = 0; index < sortedByLookups.length; index++) {
  cumulativeLookups += sortedByLookups[index]?.lookups ?? 0
  if (
    minKeysForTarget === 0 &&
    totalLookups > 0 &&
    cumulativeLookups / totalLookups >= targetHitRate
  ) {
    minKeysForTarget = index + 1
    break
  }
}

const topKeys = sortedByLookups.slice(0, 10).map((entry, index) => ({
  rank: index + 1,
  lookups: entry.lookups,
  hits: entry.hits,
  misses: entry.misses,
  stores: entry.stores,
}))
const topLossyKeys = sortedLossyByLookups.slice(0, 10).map((entry, index) => ({
  rank: index + 1,
  lookups: entry.lookups,
  distinctScoreKeys: entry.distinctScoreKeys,
}))

const elapsedMs = performance.now() - runStartTime

console.log("\nscore cache reuse summary")
console.table([
  {
    samples: sampleMetas.length,
    failedSamples,
    elapsedSeconds: round(elapsedMs / 1000, 2),
    scoreLookups: cacheStats.scoreLookups,
    scoreHits: cacheStats.scoreHits,
    scoreMisses: cacheStats.scoreMisses,
    scoreStores: cacheStats.scoreStores,
    scoreEntries: cacheStats.scoreEntries,
    coldHitRate: formatRate(
      cacheStats.scoreLookups > 0
        ? cacheStats.scoreHits / cacheStats.scoreLookups
        : 0,
    ),
    coldSelfWarmHitRate: formatRate(
      totalLookups > 0 ? coldSelfWarmHits / totalLookups : 0,
    ),
    repeatedKeyCount,
    singletonKeyCount,
    repeatedLookups,
    minKeysForTargetHitRate: minKeysForTarget || scoreKeyStats.length,
    targetHitRate: formatRate(targetHitRate),
    lossyLookups: totalLossyLookups,
    lossyDistinctKeys: lossyScoreKeyStats.length,
    lossyRepeatedKeyCount: lossyScoreKeyStats.filter(
      (entry) => entry.lookups > 1,
    ).length,
    lossyMaxLookupsPerKey: sortedLossyByLookups[0]?.lookups ?? 0,
    lossyMaxDistinctScoreKeys:
      sortedLossyByLookups[0]?.distinctScoreKeys ?? 0,
  },
])

console.log("\nprojected warm hit rate by prewarmed cache size")
console.table(capacityProjectionRows)

console.log("\nmost frequent score cache keys")
console.table(topKeys)

console.log("\nmost frequent lossy score buckets")
console.table(topLossyKeys)

const summary = {
  samples: sampleMetas.length,
  failedSamples,
  elapsedSeconds: round(elapsedMs / 1000, 2),
  scoreLookups: cacheStats.scoreLookups,
  scoreHits: cacheStats.scoreHits,
  scoreMisses: cacheStats.scoreMisses,
  scoreStores: cacheStats.scoreStores,
  scoreEntries: cacheStats.scoreEntries,
  coldHitRate: round(
    cacheStats.scoreLookups > 0
      ? (cacheStats.scoreHits / cacheStats.scoreLookups) * 100
      : 0,
    2,
  ),
  coldSelfWarmHitRate: round(
    totalLookups > 0 ? (coldSelfWarmHits / totalLookups) * 100 : 0,
    2,
  ),
  repeatedKeyCount,
  singletonKeyCount,
  repeatedLookups,
  minKeysForTargetHitRate: minKeysForTarget || scoreKeyStats.length,
  targetHitRate: round(targetHitRate * 100, 2),
  lossyLookups: totalLossyLookups,
  lossyDistinctKeys: lossyScoreKeyStats.length,
  lossyRepeatedKeyCount: lossyScoreKeyStats.filter((entry) => entry.lookups > 1)
    .length,
  lossyTopLookups: topLossyKeys.map((entry) => entry.lookups),
  lossyTopDistinctScoreKeys: topLossyKeys.map(
    (entry) => entry.distinctScoreKeys,
  ),
  topKeyLookups: topKeys.map((entry) => entry.lookups),
  capacityProjectionRows,
}

console.log(`\n${JSON.stringify(summary, null, 2)}`)
setSectionSolverLossyScoreKeyObservationEnabled(false)

function uniqueSortedNumbers(values: number[]) {
  return [...new Set(values.filter((value) => value > 0))].sort(
    (left, right) => left - right,
  )
}
