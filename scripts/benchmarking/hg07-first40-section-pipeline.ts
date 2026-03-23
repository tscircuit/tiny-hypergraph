import {
  formatBenchmarkRows,
  runSectionSolverBenchmark,
} from "./hg07-section-benchmark"

const formatPct = (value: number) => `${value.toFixed(1)}%`
const formatSeconds = (value: number) => `${(value / 1000).toFixed(1)}s`
const IMPROVEMENT_EPSILON = 1e-9

console.log("running hg-07 first 40 repeated section pipeline benchmark")

const result = runSectionSolverBenchmark({}, {
  onProgress: ({
    row,
    completedSamples,
    totalSamples,
    progressPct,
    successPct,
    improvedSampleCount,
    unchangedSampleCount,
    failedSampleCount,
    elapsedMs,
  }) => {
    const outcome = row.failed
      ? "failed"
      : row.delta > IMPROVEMENT_EPSILON
        ? `improved delta=${row.delta.toFixed(3)}`
        : "unchanged"

    console.log(
      `[${completedSamples}/${totalSamples} ${formatPct(progressPct)}] success=${formatPct(successPct)} improved=${improvedSampleCount} unchanged=${unchangedSampleCount} failed=${failedSampleCount} last=${row.sample} ${outcome} elapsed=${formatSeconds(elapsedMs)}`,
    )
  },
})

console.log("hg-07 first 40 repeated section pipeline benchmark")
console.log(
  `samples=${result.summary.samples} improved=${result.summary.improvedSampleCount} unchanged=${result.summary.unchangedSampleCount} failed=${result.summary.failedSampleCount}`,
)
console.table(formatBenchmarkRows(result.rows))
console.log("top improvements")
console.table(result.topImprovedRows)
console.log("candidate family timings")
console.table(result.summary.candidateFamilies)
console.log(JSON.stringify(result.summary, null, 2))
