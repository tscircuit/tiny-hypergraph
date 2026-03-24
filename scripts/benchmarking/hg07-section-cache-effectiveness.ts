import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import {
  clearTinyHyperGraphSectionSolverCache,
  getTinyHyperGraphSectionSolverCacheStats,
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

type CacheRow = {
  sample: string
  circuit: string
  pipelineMs: number
  cacheLookups: number
  cacheHits: number
  cacheMisses: number
  cacheRejectedHits: number
  cacheStores: number
  cacheHitRate: string
  selectedSectionCandidateLabel?: string
  failed?: boolean
  error?: string
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

const round = (value: number, digits = 3) => Number(value.toFixed(digits))
const formatRate = (hits: number, lookups: number) =>
  `${(lookups === 0 ? 0 : (hits / lookups) * 100).toFixed(1)}%`

const sampleCount = parseLimitArg()
const sampleMetas = datasetModule.manifest.samples.slice(0, sampleCount)

clearTinyHyperGraphSectionSolverCache()

console.log(
  `running hg-07 section cache effectiveness benchmark sampleCount=${sampleCount}/${datasetModule.manifest.sampleCount}`,
)

const rows: CacheRow[] = []
let totalPipelineMs = 0
let samplesWithHits = 0
let failedSamples = 0

for (const [sampleIndex, sampleMeta] of sampleMetas.entries()) {
  const serializedHyperGraph = datasetModule[
    sampleMeta.sampleName
  ] as SerializedHyperGraph
  const beforeStats = getTinyHyperGraphSectionSolverCacheStats()
  const sampleStartTime = performance.now()
  try {
    const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph,
    })

    pipelineSolver.solve()

    if (pipelineSolver.failed) {
      throw new Error(pipelineSolver.error ?? "unknown pipeline error")
    }

    const pipelineMs = performance.now() - sampleStartTime
    totalPipelineMs += pipelineMs

    const afterStats = getTinyHyperGraphSectionSolverCacheStats()
    const cacheLookups = afterStats.lookups - beforeStats.lookups
    const cacheHits = afterStats.hits - beforeStats.hits
    const cacheMisses = afterStats.misses - beforeStats.misses
    const cacheRejectedHits =
      afterStats.rejectedHits - beforeStats.rejectedHits
    const cacheStores = afterStats.stores - beforeStats.stores

    if (cacheHits > 0) {
      samplesWithHits += 1
    }

    rows.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      pipelineMs: round(pipelineMs),
      cacheLookups,
      cacheHits,
      cacheMisses,
      cacheRejectedHits,
      cacheStores,
      cacheHitRate: formatRate(cacheHits, cacheLookups),
      selectedSectionCandidateLabel: pipelineSolver.selectedSectionCandidateLabel,
    })

    console.log(
      `[${sampleIndex + 1}/${sampleMetas.length}] ${sampleMeta.sampleName} cache lookups=${cacheLookups} hits=${cacheHits} misses=${cacheMisses} cumulativeHits=${afterStats.hits}`,
    )
  } catch (error) {
    failedSamples += 1
    const pipelineMs = performance.now() - sampleStartTime
    const afterStats = getTinyHyperGraphSectionSolverCacheStats()

    rows.push({
      sample: sampleMeta.sampleName,
      circuit: sampleMeta.circuitId,
      pipelineMs: round(pipelineMs),
      cacheLookups: afterStats.lookups - beforeStats.lookups,
      cacheHits: afterStats.hits - beforeStats.hits,
      cacheMisses: afterStats.misses - beforeStats.misses,
      cacheRejectedHits: afterStats.rejectedHits - beforeStats.rejectedHits,
      cacheStores: afterStats.stores - beforeStats.stores,
      cacheHitRate: "0.0%",
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    })

    console.log(
      `[${sampleIndex + 1}/${sampleMetas.length}] ${sampleMeta.sampleName} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

const finalStats = getTinyHyperGraphSectionSolverCacheStats()

console.log("\nhg-07 section cache effectiveness summary")
console.table([
  {
    samples: sampleMetas.length,
    failedSamples,
    samplesWithHits,
    totalPipelineSeconds: round(totalPipelineMs / 1000, 2),
    cacheEntries: finalStats.entries,
    cacheLookups: finalStats.lookups,
    cacheHits: finalStats.hits,
    cacheMisses: finalStats.misses,
    cacheRejectedHits: finalStats.rejectedHits,
    cacheStores: finalStats.stores,
    cacheHitRate: formatRate(finalStats.hits, finalStats.lookups),
  },
])

console.log("\nsamples with cache hits")
console.table(rows.filter((row) => row.cacheHits > 0))
