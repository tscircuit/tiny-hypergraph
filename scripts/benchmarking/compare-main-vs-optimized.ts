import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { resolve } from "node:path"

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

type TargetModule = {
  loadSerializedHyperGraph: (serializedHyperGraph: SerializedHyperGraph) => {
    topology: any
    problem: any
  }
  TinyHyperGraphSolver: new (
    topology: any,
    problem: any,
    options?: Record<string, unknown>,
  ) => {
    solve(): void
    solved?: boolean
    failed?: boolean
    iterations?: number
    state: {
      ripCount?: number
      regionIntersectionCaches: Array<{
        existingRegionCost?: number
      }>
    }
  }
}

type LoadedSample = {
  sample: string
  topology: any
  problem: any
}

type TargetConfig = {
  label: string
  root: string
  options?: Record<string, unknown>
}

type BenchmarkSummary = {
  label: string
  avgMs: number
  avgIterations: number
  avgRips: number
  avgMaxRegionCost: number
  avgTotalRegionCost: number
  successfulRuns: number
  failedRuns: number
}

type BenchmarkAggregate = {
  label: string
  totalMs: number
  totalIterations: number
  totalRips: number
  totalMaxRegionCost: number
  totalTotalRegionCost: number
  successfulRuns: number
  failedRuns: number
  perSample: Map<
    string,
    {
      totalMs: number
      totalMaxRegionCost: number
      totalTotalRegionCost: number
      successfulRuns: number
      failedRuns: number
    }
  >
}

type PerSampleAggregate = {
  sample: string
  avgMs: number
  avgMaxRegionCost: number
  avgTotalRegionCost: number
  successfulRuns: number
  failedRuns: number
}

const datasetModule = datasetHg07 as DatasetModule

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

const formatMs = (value: number) => `${value.toFixed(2)}ms`
const round = (value: number, digits = 3) => Number(value.toFixed(digits))

const currentRoot = resolve(import.meta.dir, "../..")
const otherRootFlagIndex = process.argv.findIndex((arg) => arg === "--other-root")
const mainRoot =
  otherRootFlagIndex === -1
    ? "/tmp/tiny-hypergraph-main-bench"
    : resolve(process.argv[otherRootFlagIndex + 1] ?? "")

const importTargetModule = async (root: string): Promise<TargetModule> => {
  const [loaderModule, indexModule] = await Promise.all([
    import(resolve(root, "lib/compat/loadSerializedHyperGraph.ts")),
    import(resolve(root, "lib/index.ts")),
  ])

  return {
    loadSerializedHyperGraph: loaderModule.loadSerializedHyperGraph,
    TinyHyperGraphSolver: indexModule.TinyHyperGraphSolver,
  }
}

const loadSamplesForTarget = (
  module: TargetModule,
  limit: number,
): {
  samplesByName: Map<string, LoadedSample>
  skippedSamples: string[]
} => {
  const samplesByName = new Map<string, LoadedSample>()
  const skippedSamples: string[] = []

  for (const sampleMeta of datasetModule.manifest.samples.slice(0, limit)) {
    const serializedHyperGraph = datasetModule[
      sampleMeta.sampleName
    ] as SerializedHyperGraph

    try {
      const { topology, problem } =
        module.loadSerializedHyperGraph(serializedHyperGraph)
      samplesByName.set(sampleMeta.sampleName, {
        sample: sampleMeta.sampleName,
        topology,
        problem,
      })
    } catch {
      skippedSamples.push(sampleMeta.sampleName)
    }
  }

  return {
    samplesByName,
    skippedSamples,
  }
}

const getRegionCostSummary = (solver: {
  state: {
    regionIntersectionCaches: Array<{
      existingRegionCost?: number
    }>
  }
}) => {
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (const regionCache of solver.state.regionIntersectionCaches) {
    const regionCost = regionCache.existingRegionCost ?? 0
    if (regionCost > maxRegionCost) {
      maxRegionCost = regionCost
    }
    totalRegionCost += regionCost
  }

  return {
    maxRegionCost,
    totalRegionCost,
  }
}

const createBenchmarkAggregate = (label: string): BenchmarkAggregate => ({
  label,
  totalMs: 0,
  totalIterations: 0,
  totalRips: 0,
  totalMaxRegionCost: 0,
  totalTotalRegionCost: 0,
  successfulRuns: 0,
  failedRuns: 0,
  perSample: new Map(),
})

const benchmarkTargetPass = (
  module: TargetModule,
  samples: LoadedSample[],
  aggregate: BenchmarkAggregate,
  options: Record<string, unknown> | undefined,
) => {
  for (const sample of samples) {
    const solver = new module.TinyHyperGraphSolver(
      sample.topology,
      sample.problem,
      options,
    )
    const startTime = performance.now()
    let solveThrew = false

    try {
      solver.solve()
    } catch {
      solveThrew = true
    }

    const elapsedMs = performance.now() - startTime
    aggregate.totalMs += elapsedMs

    const sampleAgg = aggregate.perSample.get(sample.sample) ?? {
      totalMs: 0,
      totalMaxRegionCost: 0,
      totalTotalRegionCost: 0,
      successfulRuns: 0,
      failedRuns: 0,
    }
    sampleAgg.totalMs += elapsedMs

    if (solveThrew) {
      aggregate.failedRuns += 1
      sampleAgg.failedRuns += 1
      aggregate.perSample.set(sample.sample, sampleAgg)
      continue
    }

    if (solver.failed || !solver.solved) {
      aggregate.failedRuns += 1
      sampleAgg.failedRuns += 1
      aggregate.perSample.set(sample.sample, sampleAgg)
      continue
    }

    const { maxRegionCost, totalRegionCost } = getRegionCostSummary(solver)
    aggregate.successfulRuns += 1
    aggregate.totalIterations += solver.iterations ?? 0
    aggregate.totalRips += solver.state.ripCount ?? 0
    aggregate.totalMaxRegionCost += maxRegionCost
    aggregate.totalTotalRegionCost += totalRegionCost
    sampleAgg.totalMaxRegionCost += maxRegionCost
    sampleAgg.totalTotalRegionCost += totalRegionCost
    sampleAgg.successfulRuns += 1
    aggregate.perSample.set(sample.sample, sampleAgg)
  }
}

const finalizeBenchmarkAggregate = (
  aggregate: BenchmarkAggregate,
  samples: LoadedSample[],
  repeatCount: number,
) => {
  const runCount = samples.length * repeatCount
  const successfulRunCount = Math.max(aggregate.successfulRuns, 1)
  const perSampleRows: PerSampleAggregate[] = samples.map((sample) => {
    const sampleAgg = aggregate.perSample.get(sample.sample) ?? {
      totalMs: 0,
      totalMaxRegionCost: 0,
      totalTotalRegionCost: 0,
      successfulRuns: 0,
      failedRuns: 0,
    }
    const successfulSampleRuns = Math.max(sampleAgg.successfulRuns, 1)
    return {
      sample: sample.sample,
      avgMs: sampleAgg.totalMs / repeatCount,
      avgMaxRegionCost: sampleAgg.totalMaxRegionCost / successfulSampleRuns,
      avgTotalRegionCost: sampleAgg.totalTotalRegionCost / successfulSampleRuns,
      successfulRuns: sampleAgg.successfulRuns,
      failedRuns: sampleAgg.failedRuns,
    }
  })

  return {
    summary: {
      label: aggregate.label,
      avgMs: aggregate.totalMs / runCount,
      avgIterations: aggregate.totalIterations / successfulRunCount,
      avgRips: aggregate.totalRips / successfulRunCount,
      avgMaxRegionCost: aggregate.totalMaxRegionCost / successfulRunCount,
      avgTotalRegionCost: aggregate.totalTotalRegionCost / successfulRunCount,
      successfulRuns: aggregate.successfulRuns,
      failedRuns: aggregate.failedRuns,
    } satisfies BenchmarkSummary,
    perSampleRows,
    failedSamples: perSampleRows
      .filter((row) => row.failedRuns > 0)
      .map((row) => row.sample),
  }
}

const benchmarkTargets = (
  targets: Array<{
    config: TargetConfig
    module: TargetModule
    samples: LoadedSample[]
  }>,
  repeatCount: number,
) => {
  const aggregates = new Map<string, BenchmarkAggregate>()

  for (const target of targets) {
    aggregates.set(
      target.config.label,
      createBenchmarkAggregate(target.config.label),
    )
  }

  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const rotatedTarget = targets[(targetIndex + repeatIndex) % targets.length]!
      benchmarkTargetPass(
        rotatedTarget.module,
        rotatedTarget.samples,
        aggregates.get(rotatedTarget.config.label)!,
        rotatedTarget.config.options,
      )
    }
  }

  return targets.map((target) =>
    finalizeBenchmarkAggregate(
      aggregates.get(target.config.label)!,
      target.samples,
      repeatCount,
    ),
  )
}

const main = async () => {
  const limit = parsePositiveIntegerArg("--limit", 40)
  const repeatCount = parsePositiveIntegerArg("--repeat", 3)
  const modules = await Promise.all([
    importTargetModule(mainRoot),
    importTargetModule(currentRoot),
  ])

  const targets: Array<{
    config: TargetConfig
    module: TargetModule
  }> = [
    {
      config: {
        label: "main",
        root: mainRoot,
      },
      module: modules[0],
    },
    {
      config: {
        label: "current",
        root: currentRoot,
      },
      module: modules[1],
    },
  ]

  const loaded = targets.map(({ config, module }) => ({
    label: config.label,
    ...loadSamplesForTarget(module, limit),
  }))

  const sharedSampleNames = datasetModule.manifest.samples
    .slice(0, limit)
    .map((sampleMeta) => sampleMeta.sampleName)
    .filter((sampleName) =>
      loaded.every(({ samplesByName }) => samplesByName.has(sampleName)),
    )

  console.log(
    `comparing main vs current on hg07 limit=${limit} repeat=${repeatCount} shared=${sharedSampleNames.length}`,
  )
  for (const targetLoad of loaded) {
    console.log(
      `${targetLoad.label} skipped=${targetLoad.skippedSamples.length}${
        targetLoad.skippedSamples.length > 0
          ? ` (${targetLoad.skippedSamples.join(", ")})`
          : ""
      }`,
    )
  }

  const benchmarkRows = benchmarkTargets(
    targets.map(({ config, module }) => ({
      config,
      module,
      samples: sharedSampleNames.map(
        (sampleName) =>
          loaded
            .find((entry) => entry.label === config.label)!
            .samplesByName.get(sampleName)!,
      ),
    })),
    repeatCount,
  )

  const baseline = benchmarkRows[0]!.summary

  console.log("summary")
  console.table(
    benchmarkRows.map(({ summary }) => ({
      label: summary.label,
      avgMs: formatMs(summary.avgMs),
      speedupVsMain: `${(baseline.avgMs / summary.avgMs).toFixed(2)}x`,
      avgIterations: round(summary.avgIterations, 1),
      avgRips: round(summary.avgRips, 1),
      avgMaxRegionCost: round(summary.avgMaxRegionCost, 6),
      avgTotalRegionCost: round(summary.avgTotalRegionCost, 6),
      maxRegionCostDriftVsMain: round(
        summary.avgMaxRegionCost - baseline.avgMaxRegionCost,
        6,
      ),
      totalRegionCostDriftVsMain: round(
        summary.avgTotalRegionCost - baseline.avgTotalRegionCost,
        6,
      ),
      successfulRuns: summary.successfulRuns,
      failedRuns: summary.failedRuns,
    })),
  )
  for (const benchmarkRow of benchmarkRows) {
    if (benchmarkRow.failedSamples.length > 0) {
      console.log(
        `${benchmarkRow.summary.label} failed samples: ${benchmarkRow.failedSamples.join(", ")}`,
      )
    }
  }

  const mainPerSample = new Map(
    benchmarkRows[0]!.perSampleRows.map((row) => [row.sample, row]),
  )
  const currentPerSample = new Map(
    benchmarkRows[1]!.perSampleRows.map((row) => [row.sample, row]),
  )

  const perSampleDiffs = sharedSampleNames
    .map((sample) => {
      const mainRow = mainPerSample.get(sample)!
      const currentRow = currentPerSample.get(sample)!
      return {
        sample,
        avgMsMain: formatMs(mainRow.avgMs),
        avgMsCurrent: formatMs(currentRow.avgMs),
        speedupVsMain: round(mainRow.avgMs / currentRow.avgMs, 2),
        maxRegionCostMain: round(mainRow.avgMaxRegionCost, 6),
        maxRegionCostCurrent: round(currentRow.avgMaxRegionCost, 6),
        maxRegionCostDelta: round(
          currentRow.avgMaxRegionCost - mainRow.avgMaxRegionCost,
          6,
        ),
        totalRegionCostDelta: round(
          currentRow.avgTotalRegionCost - mainRow.avgTotalRegionCost,
          6,
        ),
      }
    })
    .sort((left, right) => right.speedupVsMain - left.speedupVsMain)

  console.log("fastest current gains vs main")
  console.table(perSampleDiffs.slice(0, 5))
  console.log("largest current regressions vs main")
  console.table([...perSampleDiffs].reverse().slice(0, 5))
}

await main()
