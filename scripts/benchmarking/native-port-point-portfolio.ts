import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { ParallelSelectiveReripTinyHyperGraphSolver } from "../../lib/parallel-selective-rerip-tiny-hypergraph-solver"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology, TinyHyperGraphSolverOptions, TinyHyperGraphSolver } from "../../lib/core"

const argument = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}
const inputPath = argument("--input") ?? fileURLToPath(new URL("../../tests/fixtures/srj18-sample014-native.json.gz", import.meta.url))
const source = inputPath.endsWith(".gz") ? gunzipSync(new Uint8Array(readFileSync(inputPath))).toString("utf8") : readFileSync(inputPath, "utf8")
const decode = (): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem; options: TinyHyperGraphSolverOptions } => {
  const input = JSON.parse(source, (_key, value) => {
    if (value && typeof value === "object" && value.$number) {
      if (!["Infinity", "-Infinity", "NaN"].includes(value.$number)) throw new Error("Invalid captured number")
      return Number(value.$number)
    }
    if (!value || typeof value !== "object" || !value.$typed) return value
    switch (value.$typed) {
      case "Int8Array": return Int8Array.from(value.values)
      case "Int32Array": return Int32Array.from(value.values)
      case "Uint32Array": return Uint32Array.from(value.values)
      case "Float32Array": return Float32Array.from(value.values)
      case "Float64Array": return Float64Array.from(value.values)
      default: throw new Error(`Unsupported captured array ${value.$typed}`)
    }
  })
  if (!input.topology || !input.problem || !input.options) throw new Error("Invalid native port-point capture")
  return input
}
const repeat = Number(argument("--repeat") ?? 2)
const threads = Number(argument("--threads") ?? 4)
if (!Number.isInteger(repeat) || repeat < 1 || !Number.isInteger(threads) || threads < 1) throw new Error("Repeat and threads must be positive integers")
const referencePath = argument("--reference")
const Reference: typeof SelectiveReripTinyHyperGraphSolver = referencePath ? (await import(pathToFileURL(path.resolve(referencePath, "lib/selective-rerip-tiny-hyper-graph-solver.ts")).href)).SelectiveReripTinyHyperGraphSolver : SelectiveReripTinyHyperGraphSolver
const result = (solver: ParallelSelectiveReripTinyHyperGraphSolver): string => JSON.stringify({ output: solver.getOutput(), state: solver.state, stats: solver.stats, iterations: solver.iterations })
const quality = (solver: TinyHyperGraphSolver): { maxCost: number; totalCost: number; layerChanges: number; segments: number } => {
  let maxCost = 0
  let totalCost = 0
  let layerChanges = 0
  let segments = 0
  for (const cache of solver.state.regionIntersectionCaches) {
    maxCost = Math.max(maxCost, cache.existingRegionCost)
    totalCost += cache.existingRegionCost
    layerChanges += cache.existingEntryExitLayerChanges
    segments += cache.existingSegmentCount
  }
  return { maxCost, totalCost, layerChanges, segments }
}
const input = decode()
const serial = new ParallelSelectiveReripTinyHyperGraphSolver(input.topology, input.problem, input.options)
let start = performance.now()
serial.solve()
if (!serial.solved || serial.failed) throw new Error(serial.error ?? "Serial portfolio failed")
const serialMs = performance.now() - start
const expected = result(serial)
const expectedHash = createHash("sha256").update(expected).digest("hex")
console.log(JSON.stringify({ label: "serial-parity-reference", ms: serialMs, sha256: expectedHash, iterations: serial.iterations, quality: quality(serial), stats: serial.stats }))
const runtime = new SolverRuntime({ workerCount: threads, workerUrl: new URL("./native-port-point-portfolio.worker.ts", import.meta.url), requireWorker: true })
const rows: Array<{ label: string; ms: number; iterations: number; quality: ReturnType<typeof quality> }> = []
try {
  for (let pass = 0; pass < repeat; pass++) {
    for (const label of ["reference", "portfolio", "portfolio", "reference"] as const) {
      const fresh = decode()
      const solver = label === "reference" ? new Reference(fresh.topology, fresh.problem, fresh.options) : new ParallelSelectiveReripTinyHyperGraphSolver(fresh.topology, fresh.problem, fresh.options)
      start = performance.now()
      if (solver instanceof ParallelSelectiveReripTinyHyperGraphSolver) await solver.solveAsync(runtime)
      else solver.solve()
      const ms = performance.now() - start
      if (!solver.solved || solver.failed) throw new Error(solver.error ?? `${label} failed`)
      if (solver instanceof ParallelSelectiveReripTinyHyperGraphSolver && result(solver) !== expected) throw new Error("Worker portfolio changed serial output, working state, iterations, or counters")
      const row = { label, ms, iterations: solver.iterations, quality: quality(solver) }
      rows.push(row)
      console.log(JSON.stringify(row))
    }
  }
  console.log(JSON.stringify({ inputSha256: createHash("sha256").update(source).digest("hex"), engine: process.versions, reference: referencePath ?? "current-native-selective", threads, serialPortfolioSha256: expectedHash, rows }))
} finally {
  await runtime.dispose()
}
