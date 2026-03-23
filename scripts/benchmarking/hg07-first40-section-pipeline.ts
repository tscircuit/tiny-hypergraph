import {
  formatBenchmarkRows,
  runSectionSolverBenchmark,
} from "./hg07-section-benchmark"

const result = runSectionSolverBenchmark()

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
