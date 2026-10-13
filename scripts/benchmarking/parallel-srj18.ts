import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { resolve } from "node:path"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  ParallelTinyHyperGraphSolver,
  solveTinyHyperGraphsParallel,
  type SolveResult,
} from "../../lib/parallel"

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag)
  return i < 0 ? fallback : process.argv[i + 1]
}
const dir = resolve(arg("--input-dir", "work/srj18"))
const repeats = Number(arg("--repeat", "3"))
const outputPath = arg("--out", "work/parallel-srj18-results.json")
if (!Number.isSafeInteger(repeats) || repeats < 1)
  throw new Error("--repeat must be positive")
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".hg.json"))
  .sort()
if (!files.length) throw new Error("No hypergraph inputs")
const graphs = files.map((file) =>
  JSON.parse(readFileSync(resolve(dir, file), "utf8"), (_, v) =>
    v === "Infinity" ? Infinity : v,
  ),
)
const sources = files.map((file) =>
  JSON.parse(
    readFileSync(
      resolve(dir, file.replace(".hg.json", ".source.json")),
      "utf8",
    ),
  ),
)
for (let i = 0; i < files.length; i++) {
  if (sources[i].datasetCommit !== "100e8957ce789b5b288e14c476dc83f4efc5214b")
    throw new Error("Unexpected srj18 revision")
  if (
    createHash("sha256")
      .update(readFileSync(resolve(dir, files[i])))
      .digest("hex") !== sources[i].graphSha256
  )
    throw new Error(`Input checksum mismatch: ${files[i]}`)
}
const fingerprint = (result: SolveResult) =>
  createHash("sha256").update(JSON.stringify(result)).digest("hex")
const serialSolve = (graph: any): SolveResult => {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.solve()
  return {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    output: solver.solved && !solver.failed ? solver.getOutput() : null,
    stats: solver.stats,
  }
}
const runSerial = () =>
  graphs.map((graph) => {
    const t = performance.now()
    const result = serialSolve(graph)
    return { result, ms: performance.now() - t }
  })
console.log("Warmup: all inputs, original serial solver")
const warm = runSerial(),
  fingerprints = warm.map((row) => fingerprint(row.result))
const report: any = {
  tinyHypergraphBaseCommit: "16dd24a73acc4175a118fe2e109b06f091f514ac",
  datasetCommit: sources[0].datasetCommit,
  autorouterVersion: sources[0].autorouterVersion,
  effort: sources[0].effort,
  runtime: Bun.version,
  cpu: cpus()[0]?.model,
  logicalCpus: cpus().length,
  cpuQuota: existsSync("/sys/fs/cgroup/cpu.max")
    ? readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim()
    : null,
  repeats,
  inputs: sources,
  serial: [],
  batch: [],
  withinGraph: [],
  outputFingerprints: fingerprints,
}
const verify = (results: SolveResult[], label: string) => {
  results.forEach((result, i) => {
    if (fingerprint(result) !== fingerprints[i])
      throw new Error(`${label}: serial mismatch in ${files[i]}`)
  })
}
for (let repeat = 0; repeat < repeats; repeat++) {
  const t = performance.now()
  const rows = runSerial()
  const ms = performance.now() - t
  verify(
    rows.map((r) => r.result),
    "serial",
  )
  report.serial.push({
    repeat,
    ms,
    samples: rows.map((r, i) => ({
      sample: sources[i].sample,
      ms: r.ms,
      solved: r.result.solved,
      failed: r.result.failed,
      iterations: r.result.iterations,
    })),
  })
  console.log("serial", repeat, ms.toFixed(1) + "ms")
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  for (const workers of [1, 2, 4]) {
    const t = performance.now()
    const results = await solveTinyHyperGraphsParallel(graphs, { workers })
    const ms = performance.now() - t
    verify(results, `batch-${workers}`)
    report.batch.push({ repeat, workers, ms, allMatched: true })
    console.log("batch", workers, repeat, ms.toFixed(1) + "ms")
    writeFileSync(outputPath, JSON.stringify(report, null, 2))
  }
}
// Measure one graph at a time, with parallel route searches inside each graph.
for (const workers of [2, 4])
  for (let repeat = 0; repeat < repeats; repeat++) {
    const rows = []
    for (let i = 0; i < graphs.length; i++) {
      const t = performance.now(),
        { topology, problem } = loadSerializedHyperGraph(graphs[i])
      const solver = new ParallelTinyHyperGraphSolver(topology, problem, {
        workers,
      })
      await solver.solveAsync()
      const ms = performance.now() - t
      const result: SolveResult = {
        solved: solver.solved,
        failed: solver.failed,
        error: solver.error,
        iterations: solver.iterations,
        output: solver.solved && !solver.failed ? solver.getOutput() : null,
        stats: solver.stats,
      }
      if (fingerprint(result) !== fingerprints[i])
        throw new Error(`within-graph-${workers}: mismatch in ${files[i]}`)
      rows.push({
        sample: sources[i].sample,
        ms,
        ...solver.parallelStats,
        allMatched: true,
      })
      console.log(
        "within-graph",
        workers,
        repeat,
        sources[i].sample,
        ms.toFixed(1) + "ms",
      )
    }
    report.withinGraph.push({
      workers,
      repeat,
      ms: rows.reduce((n, r) => n + r.ms, 0),
      samples: rows,
    })
    writeFileSync(outputPath, JSON.stringify(report, null, 2))
  }
console.log(
  "All outputs, status, errors, iterations and deterministic stats match the original serial solver.",
)
