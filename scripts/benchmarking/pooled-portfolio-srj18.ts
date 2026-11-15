import { createHash } from "node:crypto"
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { availableParallelism, cpus } from "node:os"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphPortfolioPool } from "../../lib/parallel"
import {
  PORTFOLIO_PLANS,
  measureRoutingQuality,
} from "../../lib/parallel/portfolio-candidate"

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? fallback : process.argv[i + 1]
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const parse = (path: string) =>
  JSON.parse(readFileSync(path, "utf8"), (_, v) =>
    v === "Infinity" ? Infinity : v,
  )
const dir = resolve(arg("--input-dir", "work/srj18"))
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".hg.json"))
  .sort()
if (files.length !== 16) throw new Error("Expected all 16 srj18 inputs")
const sources = files.map((f) =>
  parse(resolve(dir, f.replace(".hg.json", ".source.json"))),
)
for (let i = 0; i < files.length; i++) {
  if (sources[i].datasetCommit !== "100e8957ce789b5b288e14c476dc83f4efc5214b")
    throw new Error("Wrong srj18 revision")
  if (
    createHash("sha256")
      .update(readFileSync(resolve(dir, files[i])))
      .digest("hex") !== sources[i].graphSha256
  )
    throw new Error("Input checksum mismatch")
}

if (process.argv.includes("--child")) {
  const mode = arg("--mode", "portfolio"),
    workers = Number(arg("--workers", "8"))
  const budget = Number(arg("--budget", "250000"))
  const baselineBudget = Number(arg("--baseline-budget", "250000"))
  const backend = arg("--backend", "wasm") as "wasm" | "javascript"
  const graphs = files.map((f) => parse(resolve(dir, f)))
  // Warm the original core outside measurement, identically for all modes.
  // Candidate workers start cold; initialization and shutdown are included.
  for (const graph of graphs) {
    const { topology, problem } = loadSerializedHyperGraph(graph)
    new TinyHyperGraphSolver(topology, problem, {
      MAX_ITERATIONS: 10000,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
    }).solve()
  }
  let cpuStart = process.cpuUsage(),
    start = performance.now()
  const pool =
    mode === "portfolio"
      ? new TinyHyperGraphPortfolioPool({
          workers,
          backend,
          baselineIterations: baselineBudget,
        })
      : undefined
  const startupMs = performance.now() - start
  let cpu = process.cpuUsage(cpuStart)
  let cpuMs = (cpu.user + cpu.system) / 1000
  let ms = startupMs
  const samples = []
  try {
    for (let i = 0; i < graphs.length; i++) {
      cpuStart = process.cpuUsage()
      start = performance.now()
      let result
      if (pool) result = await pool.solve(graphs[i], { MAX_ITERATIONS: budget })
      else {
        const { topology, problem } = loadSerializedHyperGraph(graphs[i])
        const solver = new TinyHyperGraphSolver(topology, problem, {
          MAX_ITERATIONS: 1000000,
        })
        solver.solve()
        result = {
          solved: solver.solved,
          failed: solver.failed,
          error: solver.error,
          iterations: solver.iterations,
          stats: solver.stats,
          quality: measureRoutingQuality(solver),
          output: solver.solved && !solver.failed ? solver.getOutput() : null,
        }
      }
      const sampleMs = performance.now() - start
      cpu = process.cpuUsage(cpuStart)
      const sampleCpuMs = (cpu.user + cpu.system) / 1000
      ms += sampleMs
      cpuMs += sampleCpuMs
      const { output, ...state } = result
      const semantic = { ...state, outputHash: hash(output) }
      samples.push({
        sample: sources[i].sample,
        ms: sampleMs,
        cpuMs: sampleCpuMs,
        fingerprint: hash(semantic),
        ...semantic,
      })
      console.error(
        `${mode}-${workers} ${sources[i].sample}: ${(sampleMs / 1000).toFixed(3)}s solved=${result.solved}`,
      )
    }
  } finally {
    cpuStart = process.cpuUsage()
    start = performance.now()
    await pool?.close()
    ms += performance.now() - start
    cpu = process.cpuUsage(cpuStart)
    cpuMs += (cpu.user + cpu.system) / 1000
  }
  console.log(
    JSON.stringify({
      ms,
      cpuMs,
      startupMs,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      successCount: samples.filter((s) => s.solved && !s.failed).length,
      modelValidCompletionCount: samples.filter(
        (s) =>
          s.solved && !s.failed && s.quality.singleLayerIntersections === 0,
      ).length,
      samples,
    }),
  )
} else {
  const repeat = Number(arg("--repeat", "3"))
  const budget = Number(arg("--budget", "250000"))
  const baselineBudget = Number(arg("--baseline-budget", "250000"))
  const backend = arg("--backend", "wasm")
  const workers = arg("--workers", "1,8").split(",").map(Number)
  if (
    ![repeat, budget, baselineBudget, ...workers].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Error("Invalid benchmark configuration")
  const out = arg("--out", "work/pooled-portfolio-results.json")
  const readOptional = (path: string) =>
    existsSync(path) ? readFileSync(path, "utf8").trim() : null
  const report: any = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    algorithm: "fixed-eight-candidate-portfolio",
    backend,
    nativeKernelSha256: createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "../../lib/parallel/native-route-search.wasm",
            import.meta.url,
          ),
        ),
      )
      .digest("hex"),
    poolLifecycle: "one pool per sequential 16-graph suite",
    portfolioConfig: {
      candidateCount: 8,
      baselineIterations: baselineBudget,
      MAX_ITERATIONS: budget,
      plans: PORTFOLIO_PLANS,
    },
    datasetCommit: sources[0].datasetCommit,
    autorouterVersion: sources[0].autorouterVersion,
    inputEffort: sources[0].effort,
    inputs: sources,
    runtime: Bun.version,
    cpu: cpus()[0]?.model,
    visibleCpus: cpus().length,
    availableCpus: availableParallelism(),
    cpuAffinity: readOptional("/proc/self/status")?.match(
      /^Cpus_allowed_list:\s*(.+)$/m,
    )?.[1],
    cpuQuota: readOptional("/sys/fs/cgroup/cpu.max"),
    cpuQuotaV1: readOptional("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
    cpuPeriodV1: readOptional("/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
    repeats: repeat,
    workerCounts: workers,
    trials: [],
    completed: false,
    methodology:
      "Each trial uses an isolated child process and runs all 16 graphs sequentially. One persistent pool; startup/termination included. No concurrency between graphs. Timed input conversion, shared distance preparation, all candidate searches/selection/quality metrics, and output conversion. Input parsing, 10k-step original-core warmups, output hashing and determinism checks excluded. CPU time covers all threads. Peak RSS includes all inputs, warmups and hashing. Single-layer audit is a model constraint check, not PCB DRC.",
  }
  const expected = new Map<string, string>()
  const configs = [
    ...(process.argv.includes("--prototype-only")
      ? []
      : [{ mode: "serial", workers: 1 }]),
    ...workers.map((workers) => ({ mode: "portfolio", workers })),
  ]
  for (let run = 0; run < repeat; run++)
    for (const config of configs) {
      const proc = Bun.spawn(
        [
          process.execPath,
          fileURLToPath(import.meta.url),
          "--child",
          "--input-dir",
          dir,
          "--mode",
          config.mode,
          "--workers",
          String(config.workers),
          "--budget",
          String(budget),
          "--backend",
          backend,
          "--baseline-budget",
          String(baselineBudget),
        ],
        { stdout: "pipe", stderr: "inherit" },
      )
      const [stdout, code] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ])
      if (code !== 0) throw new Error(`Benchmark child exited ${code}`)
      const trial = JSON.parse(stdout)
      for (const sample of trial.samples) {
        const key = `${config.mode}-${sample.sample}`
        if (expected.has(key) && expected.get(key) !== sample.fingerprint)
          throw new Error(
            `Determinism mismatch: ${key}, workers=${config.workers}`,
          )
        expected.set(key, sample.fingerprint)
      }
      report.trials.push({ run, ...config, ...trial })
      writeFileSync(out, JSON.stringify(report, null, 2))
      console.log(
        `${config.mode}-${config.workers} run=${run}: ${(trial.ms / 1000).toFixed(3)}s, completed=${trial.successCount}/16, model-valid=${trial.modelValidCompletionCount}/16`,
      )
    }
  report.completed = true
  report.allWorkerCountsMatch = workers.length > 1 ? true : null
  writeFileSync(out, JSON.stringify(report, null, 2))
}
