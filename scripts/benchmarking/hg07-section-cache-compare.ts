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

type ModeSummary = {
  mode: string
  samples: number
  failedSamples: number
  totalPipelineSeconds: number
  averagePipelineMs: number
  cacheEntries: number
  cacheLookups: number
  cacheHits: number
  cacheMisses: number
  cacheRejectedHits: number
  cacheStores: number
  cacheHitRate: string
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

const round = (value: number, digits = 2) => Number(value.toFixed(digits))
const formatRate = (hits: number, lookups: number) =>
  `${(lookups === 0 ? 0 : (hits / lookups) * 100).toFixed(1)}%`

const runMode = ({
  mode,
  sampleCount,
  enableCache,
  clearCacheBeforeRun,
}: {
  mode: string
  sampleCount: number
  enableCache: boolean
  clearCacheBeforeRun: boolean
}): ModeSummary => {
  if (clearCacheBeforeRun) {
    clearTinyHyperGraphSectionSolverCache()
  }

  const sampleMetas = datasetModule.manifest.samples.slice(0, sampleCount)
  const beforeStats = getTinyHyperGraphSectionSolverCacheStats()
  const runStartTime = performance.now()
  let failedSamples = 0

  console.log(`\n${mode} run starting sampleCount=${sampleCount}`)

  for (const [sampleIndex, sampleMeta] of sampleMetas.entries()) {
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
        serializedHyperGraph,
        sectionSolverOptions: {
          ENABLE_CACHE: enableCache,
        },
      })
      pipelineSolver.solve()

      if (pipelineSolver.failed) {
        throw new Error(pipelineSolver.error ?? "unknown pipeline error")
      }

      const stats = getTinyHyperGraphSectionSolverCacheStats()
      console.log(
        `[${sampleIndex + 1}/${sampleMetas.length}] ${sampleMeta.sampleName} cumulativeHits=${stats.hits - beforeStats.hits}`,
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

  const afterStats = getTinyHyperGraphSectionSolverCacheStats()
  const elapsedMs = performance.now() - runStartTime
  const cacheLookups = afterStats.lookups - beforeStats.lookups
  const cacheHits = afterStats.hits - beforeStats.hits
  const cacheMisses = afterStats.misses - beforeStats.misses
  const cacheRejectedHits = afterStats.rejectedHits - beforeStats.rejectedHits
  const cacheStores = afterStats.stores - beforeStats.stores
  const successfulSamples = sampleMetas.length - failedSamples

  return {
    mode,
    samples: sampleMetas.length,
    failedSamples,
    totalPipelineSeconds: round(elapsedMs / 1000, 2),
    averagePipelineMs:
      successfulSamples > 0 ? round(elapsedMs / successfulSamples, 2) : 0,
    cacheEntries: afterStats.entries,
    cacheLookups,
    cacheHits,
    cacheMisses,
    cacheRejectedHits,
    cacheStores,
    cacheHitRate: formatRate(cacheHits, cacheLookups),
  }
}

const sampleCount = parseLimitArg()

const noCacheSummary = runMode({
  mode: "no-cache",
  sampleCount,
  enableCache: false,
  clearCacheBeforeRun: true,
})

const coldStartSummary = runMode({
  mode: "cold-start-cache",
  sampleCount,
  enableCache: true,
  clearCacheBeforeRun: true,
})

const warmedSummary = runMode({
  mode: "warmed-cache",
  sampleCount,
  enableCache: true,
  clearCacheBeforeRun: false,
})

const noCacheSeconds = Math.max(noCacheSummary.totalPipelineSeconds, 1e-9)
const coldStartSeconds = Math.max(coldStartSummary.totalPipelineSeconds, 1e-9)

console.log("\nhg-07 section cache mode comparison")
console.table([
  noCacheSummary,
  coldStartSummary,
  {
    ...warmedSummary,
    speedupVsNoCache: round(noCacheSeconds / warmedSummary.totalPipelineSeconds),
    speedupVsColdStart: round(
      coldStartSeconds / warmedSummary.totalPipelineSeconds,
    ),
  },
])
