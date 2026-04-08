import {
  defaultUnravelBenchmarkConfig,
  formatUnravelBenchmarkRows,
  runUnravelBenchmark,
} from "./hg07-unravel-benchmark"

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

const sampleCount = parsePositiveIntegerArg(
  "--limit",
  defaultUnravelBenchmarkConfig.sampleCount,
)
const maxSearchStates = parsePositiveIntegerArg(
  "--states",
  defaultUnravelBenchmarkConfig.unravelOptions.MAX_SEARCH_STATES ?? 8,
)
const maxMutationDepth = parsePositiveIntegerArg(
  "--depth",
  defaultUnravelBenchmarkConfig.unravelOptions.MAX_MUTATION_DEPTH ?? 2,
)
const maxEnqueuedMutationsPerState = parsePositiveIntegerArg(
  "--beam",
  defaultUnravelBenchmarkConfig.unravelOptions
    .MAX_ENQUEUED_MUTATIONS_PER_STATE ?? 2,
)

console.log(
  `running hg-07 unravel benchmark sampleCount=${sampleCount} depth=${maxMutationDepth} states=${maxSearchStates} beam=${maxEnqueuedMutationsPerState}`,
)

const benchmarkResult = runUnravelBenchmark(
  {
    sampleCount,
    unravelOptions: {
      MAX_SEARCH_STATES: maxSearchStates,
      MAX_MUTATION_DEPTH: maxMutationDepth,
      MAX_ENQUEUED_MUTATIONS_PER_STATE: maxEnqueuedMutationsPerState,
    },
  },
  {
    onProgress: (progress) => {
      const row = progress.row
      if (row.failed) {
        console.log(
          `[${progress.completedSamples}/${progress.totalSamples}] ${row.sample} failed`,
        )
        return
      }

      console.log(
        `[${progress.completedSamples}/${progress.totalSamples}] ${row.sample} baseline=${row.baselineMaxRegionCost.toFixed(6)} section=${row.sectionFinalMaxRegionCost.toFixed(6)} unravel=${row.unravelFinalMaxRegionCost.toFixed(6)} mutationDepth=${row.mutationDepth}`,
      )
    },
  },
)

console.log("\nTop Unravel Rows")
console.table(benchmarkResult.topUnravelRows)

console.log("\nAll Rows")
console.table(formatUnravelBenchmarkRows(benchmarkResult.rows))

console.log("\nSummary")
console.log(JSON.stringify(benchmarkResult.summary, null, 2))
