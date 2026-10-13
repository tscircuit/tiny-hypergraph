import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { cpus, availableParallelism } from "node:os"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  FixedRoundTinyHyperGraphSolver,
  solveTinyHyperGraphPortfolio,
} from "../../lib/parallel"
import { PORTFOLIO_PLANS } from "../../lib/parallel/portfolio-candidate"

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag)
  return i < 0 ? fallback : process.argv[i + 1]
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const parse = (path: string) =>
  JSON.parse(readFileSync(path, "utf8"), (_, v) =>
    v === "Infinity" ? Infinity : v,
  )

if (process.argv.includes("--child")) {
  const graph = parse(arg("--file", "")),
    workers = Number(arg("--workers", "1")),
    mode = arg("--mode", "fixed")
  const budget = Number(arg("--budget", "2000000")),
    roundSize = Number(arg("--round-size", "32"))
  const routeStepLimit = Number(arg("--route-step-limit", "50000"))
  const portConflictPenalty = Number(arg("--port-conflict-penalty", "1"))
  // Warm core arithmetic outside the measurement; worker startup remains included.
  const warmInput = loadSerializedHyperGraph(graph)
  const warm = new TinyHyperGraphSolver(warmInput.topology, warmInput.problem, {
    MAX_ITERATIONS: 10000,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    GREEDY_FINAL_ROUTE_ITERS: 0,
  })
  warm.solve()
  const cpuStart = process.cpuUsage(),
    start = performance.now()
  if (mode === "portfolio") {
    const result = await solveTinyHyperGraphPortfolio(graph, {
      workers,
      solverOptions: { MAX_ITERATIONS: budget },
    })
    const ms = performance.now() - start,
      cpu = process.cpuUsage(cpuStart)
    const { output, ...semantic } = result
    const state = { ...semantic, outputHash: hash(output) }
    console.log(
      JSON.stringify({
        ms,
        cpuMs: (cpu.user + cpu.system) / 1000,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
        fingerprint: hash(state),
        ...state,
      }),
    )
    process.exit(0)
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver =
    mode === "serial"
      ? new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: budget })
      : new FixedRoundTinyHyperGraphSolver(topology, problem, {
          workers,
          ROUND_SIZE: roundSize,
          ROUTE_STEP_LIMIT: routeStepLimit,
          PORT_CONFLICT_PENALTY: portConflictPenalty,
          MAX_ITERATIONS: budget,
        })
  if (solver instanceof FixedRoundTinyHyperGraphSolver)
    await solver.solveAsync()
  else solver.solve()
  const output = solver.solved && !solver.failed ? solver.getOutput() : null
  const ms = performance.now() - start,
    cpu = process.cpuUsage(cpuStart)
  let maxRegionCost = 0,
    totalRegionCost = 0,
    pathLength = 0,
    layerChanges = 0,
    segments = 0
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const cache = solver.state.regionIntersectionCaches[regionId]
    maxRegionCost = Math.max(maxRegionCost, cache.existingRegionCost)
    totalRegionCost += cache.existingRegionCost
    if (
      solver instanceof FixedRoundTinyHyperGraphSolver &&
      solver.isKnownSingleLayerRegion(regionId) &&
      cache.existingSameLayerIntersections !== 0
    )
      throw new Error("Single-layer crossing invariant violated")
    for (const [routeId, a, b] of solver.state.regionSegments[regionId]) {
      if (
        solver.state.portAssignment[a] !== problem.routeNet[routeId] ||
        solver.state.portAssignment[b] !== problem.routeNet[routeId]
      )
        throw new Error("Port ownership invariant violated")
      const dx = topology.portX[a] - topology.portX[b],
        dy = topology.portY[a] - topology.portY[b]
      pathLength += Math.sqrt(dx * dx + dy * dy)
      layerChanges += Number(topology.portZ[a] !== topology.portZ[b])
      segments++
    }
  }
  const state = {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    stats: solver.stats,
    roundStats:
      solver instanceof FixedRoundTinyHyperGraphSolver
        ? solver.roundStats
        : null,
    outputHash: hash(output),
    routingStateHash: hash({
      ports: Array.from(solver.state.portAssignment),
      segments: solver.state.regionSegments,
    }),
    quality: {
      maxRegionCost,
      totalRegionCost,
      pathLength,
      layerChanges,
      segments,
    },
  }
  console.log(
    JSON.stringify({
      ms,
      cpuMs: (cpu.user + cpu.system) / 1000,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      fingerprint: hash(state),
      executionStats:
        solver instanceof FixedRoundTinyHyperGraphSolver
          ? solver.executionStats
          : null,
      ...state,
    }),
  )
} else {
  const dir = resolve(arg("--input-dir", "work/srj18")),
    out = arg("--out", "work/fixed-round-srj18-results.json")
  const repeat = Number(arg("--repeat", "1")),
    roundSize = Number(arg("--round-size", "32"))
  const routeStepLimit = Number(arg("--route-step-limit", "50000"))
  const portConflictPenalty = Number(arg("--port-conflict-penalty", "1"))
  const workerCounts = arg("--workers", "1,2,4,8").split(",").map(Number)
  const portfolio = process.argv.includes("--portfolio")
  if (
    !workerCounts.length ||
    workerCounts.some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    throw new Error("Invalid --workers")
  if (!Number.isSafeInteger(repeat) || repeat < 1)
    throw new Error("--repeat must be positive")
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".hg.json"))
    .sort()
  if (files.length !== 16) throw new Error("Expected all 16 srj18 hypergraphs")
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
  const quota = existsSync("/sys/fs/cgroup/cpu.max")
    ? readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim()
    : null
  const report: any = {
    datasetCommit: sources[0].datasetCommit,
    autorouterVersion: sources[0].autorouterVersion,
    inputEffort: sources[0].effort,
    runtime: Bun.version,
    cpu: cpus()[0]?.model,
    visibleCpus: cpus().length,
    availableCpus: availableParallelism(),
    cpuAffinity: existsSync("/proc/self/status")
      ? readFileSync("/proc/self/status", "utf8").match(
          /^Cpus_allowed_list:\s*(.+)$/m,
        )?.[1]
      : null,
    cpuQuota: quota,
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    algorithm: portfolio ? "fixed-eight-candidate-portfolio" : "fixed-round",
    portfolioConfig: portfolio
      ? {
          candidateCount: 8,
          MAX_ITERATIONS: 250000,
          plans: PORTFOLIO_PLANS,
        }
      : null,
    prototypeConfig: portfolio
      ? null
      : {
          ROUND_SIZE: roundSize,
          ROUTE_STEP_LIMIT: routeStepLimit,
          PORT_CONFLICT_PENALTY: portConflictPenalty,
          RETRIES_BEFORE_RIP: 8,
          MAX_ITERATIONS: 2000000,
          GREEDY_FINAL_ROUTE_ITERS: 0,
        },
    repeats: repeat,
    workerCounts,
    inputs: sources,
    trials: [],
    allWorkerCountsMatch: true,
    methodology:
      "Sequential isolated child processes; core warmup and file parsing excluded. Timed conversion, solve, output conversion, worker startup and cleanup. CPU time covers all threads. Peak RSS includes input and warmup. Worker count is not CPU capacity; consult cpuQuota and visibleCpus before interpreting scaling.",
  }
  const expected = new Map<string, string>()
  const resumePath = arg("--resume", "")
  if (resumePath) {
    const prior = parse(resumePath)
    if (
      JSON.stringify(prior.prototypeConfig) !==
        JSON.stringify(report.prototypeConfig) ||
      prior.runtime !== report.runtime ||
      prior.cpuQuota !== report.cpuQuota ||
      prior.cpuAffinity !== report.cpuAffinity ||
      JSON.stringify(prior.portfolioConfig) !==
        JSON.stringify(report.portfolioConfig) ||
      prior.datasetCommit !== report.datasetCommit
    )
      throw new Error("Resume configuration does not match")
    report.trials = prior.trials
    report.workerCounts = [...new Set([...prior.workerCounts, ...workerCounts])]
    for (const trial of prior.trials)
      for (const sample of trial.samples) {
        expected.set(
          `${trial.mode}-${trial.budget}-${sample.sample}.hg.json`,
          sample.fingerprint,
        )
      }
  }
  const controls = [
    { mode: "serial", workers: 1, budget: 1000000, label: "serial-1m" },
    ...(portfolio || process.argv.includes("--skip-equal-budget")
      ? []
      : [
          {
            mode: "fixed",
            workers: 1,
            budget: 1000000,
            label: "fixed-equal-budget-1m",
          },
        ]),
  ]
  const modes = [
    ...(process.argv.includes("--prototype-only") ? [] : controls),
    ...workerCounts.map((workers) => ({
      mode: portfolio ? "portfolio" : "fixed",
      workers,
      budget: portfolio ? 250000 : 2000000,
      label: portfolio ? `portfolio-${workers}-8x250k` : `fixed-${workers}-2m`,
    })),
  ]
  for (let run = 0; run < repeat; run++)
    for (const config of modes) {
      const samples = []
      for (let i = 0; i < files.length; i++) {
        const proc = Bun.spawn(
          [
            process.execPath,
            fileURLToPath(import.meta.url),
            "--child",
            "--file",
            resolve(dir, files[i]),
            "--mode",
            config.mode,
            "--workers",
            String(config.workers),
            "--budget",
            String(config.budget),
            "--round-size",
            String(roundSize),
            "--route-step-limit",
            String(routeStepLimit),
            "--port-conflict-penalty",
            String(portConflictPenalty),
          ],
          { stdout: "pipe", stderr: "pipe" },
        )
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ])
        if (exitCode !== 0)
          throw new Error(`${files[i]} ${config.label}: ${stderr}`)
        const result = JSON.parse(stdout.trim())
        const key = `${config.mode}-${config.budget}-${files[i]}`
        if (expected.has(key) && expected.get(key) !== result.fingerprint)
          throw new Error(`Determinism mismatch: ${key}, ${config.label}`)
        expected.set(key, result.fingerprint)
        samples.push({ sample: sources[i].sample, ...result })
        console.log(
          `${config.label} run=${run} ${sources[i].sample}: ${(result.ms / 1000).toFixed(3)}s solved=${result.solved} maxCost=${result.quality.maxRegionCost.toFixed(4)}`,
        )
      }
      report.trials.push({
        run,
        ...config,
        ms: samples.reduce((n, s) => n + s.ms, 0),
        cpuMs: samples.reduce((n, s) => n + s.cpuMs, 0),
        successCount: samples.filter((s) => s.solved && !s.failed).length,
        samples,
      })
      writeFileSync(out, JSON.stringify(report, null, 2))
    }
  report.allWorkerCountsMatch = report.workerCounts.length > 1 ? true : null
  report.completed = true
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(
    `Completed; deterministic results verified for workers=${workerCounts.join(",")}.`,
  )
}
