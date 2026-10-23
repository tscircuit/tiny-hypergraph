import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphTopology,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
} from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

type Solver = {
  solve(): void
  solved: boolean
  failed: boolean
  error: string | null
  iterations: number
  stats: Record<string, unknown>
  getOutput(): unknown
}
type SolverConstructor = new (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options: TinyHyperGraphSolverOptions,
) => Solver
type CapturedInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
}

const argument = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}
const inputPath = argument("--input")
if (!inputPath) {
  throw new Error("Pass --input captured-port-pathing.json and optionally --reference /path/to/tiny-hypergraph --repeat 2")
}
const repeat = Number(argument("--repeat") ?? 2)
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("Invalid --repeat")
const source = readFileSync(inputPath, "utf8")
const decodeInput = (): CapturedInput => {
  const input = JSON.parse(source, (_key, value) => {
    if (!value || typeof value !== "object" || !value.$typed) return value
    switch (value.$typed) {
      case "Int8Array": return Int8Array.from(value.values)
      case "Int32Array": return Int32Array.from(value.values)
      case "Uint32Array": return Uint32Array.from(value.values)
      case "Float64Array": return Float64Array.from(value.values)
      default: throw new Error(`Unsupported captured array: ${value.$typed}`)
    }
  })
  if (input.solverInput) {
    // The dataset package also contains historical completed Pipeline7 inputs.
    // Identify this mode explicitly; it is not a fresh Pipeline9 extraction.
    const loaded = loadSerializedHyperGraph(input.solverInput.serializedHyperGraph)
    return { ...loaded, options: {
      ...input.solverInput.solveGraphOptions,
      OWNED_REGIONAL_HOP_FRONTIER: true,
      USE_SPARSE_CANDIDATE_STORAGE: false,
    } }
  }
  if (!input.topology || !input.problem || !input.options) {
    throw new Error("Invalid native port-pathing capture")
  }
  return input
}

const referencePath = argument("--reference")
const Reference: SolverConstructor = referencePath
  ? (await import(pathToFileURL(path.resolve(referencePath,
      "lib/selective-rerip-tiny-hyper-graph-solver.ts")).href)).SelectiveReripTinyHyperGraphSolver
  : SelectiveReripTinyHyperGraphSolver
let expected: string | undefined
const rows: Array<{ label: string; ms: number; iterations: number; sha256: string }> = []
for (let pass = 0; pass < repeat; pass++) {
  for (const [label, Constructor] of [
    ["reference", Reference], ["candidate", SelectiveReripTinyHyperGraphSolver],
    ["candidate", SelectiveReripTinyHyperGraphSolver], ["reference", Reference],
  ] as const) {
    const input = decodeInput()
    const start = performance.now()
    const solver = new Constructor(input.topology, input.problem, input.options)
    solver.solve()
    const ms = performance.now() - start
    if (!solver.solved || solver.failed) throw new Error(solver.error ?? "Port-pathing failed")
    const result = JSON.stringify({
      output: solver.getOutput(), iterations: solver.iterations, stats: solver.stats,
    })
    if (expected !== undefined && result !== expected) {
      throw new Error(`${label} changed output, iterations or non-timing counters`)
    }
    expected = result
    const row = {label, ms, iterations: solver.iterations,
      sha256: createHash("sha256").update(result).digest("hex")}
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}
console.log(JSON.stringify({
  inputSha256: createHash("sha256").update(source).digest("hex"),
  engine: process.versions, reference: referencePath ?? "self", rows,
}))
