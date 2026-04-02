import type {
  CandidateFamily,
  SectionSolverBenchmarkConfig,
} from "./hg07-section-benchmark"
import {
  defaultSectionSolverBenchmarkConfig,
  legacySectionSolverBenchmarkConfig,
  runSectionSolverBenchmark,
} from "./hg07-section-benchmark"

type BenchmarkVariant = {
  name: string
  config: Omit<Partial<SectionSolverBenchmarkConfig>, "sectionSolver"> & {
    sectionSolver?: Partial<SectionSolverBenchmarkConfig["sectionSolver"]>
  }
}

const allFamilies: CandidateFamily[] = [
  "self-all",
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]

const variants: BenchmarkVariant[] = [
  {
    name: "default",
    config: {},
  },
  {
    name: "single-pass",
    config: {
      maxPasses: 1,
    },
  },
  {
    name: "single-pass-hot8",
    config: {
      maxPasses: 1,
      maxHotRegions: 8,
    },
  },
  {
    name: "single-pass-hot8-beat-and-stop",
    config: {
      maxPasses: 1,
      maxHotRegions: 8,
      sectionSolver: {
        maxRipsWithoutMaxRegionCostImprovement: 2,
        extraRipsAfterBeatingBaselineMaxRegionCost: 0,
      },
    },
  },
  {
    name: "single-pass-hot8-beat-and-one-extra",
    config: {
      maxPasses: 1,
      maxHotRegions: 8,
      sectionSolver: {
        maxRipsWithoutMaxRegionCostImprovement: 3,
        extraRipsAfterBeatingBaselineMaxRegionCost: 1,
      },
    },
  },
  {
    name: "single-pass-hot8-focused-families",
    config: {
      maxPasses: 1,
      maxHotRegions: 8,
      candidateFamilies: [
        "onehop-all",
        "onehop-touch",
        "twohop-all",
        "twohop-touch",
      ],
    },
  },
  {
    name: "single-pass-hot6-focused-families-beat-and-stop",
    config: {
      maxPasses: 1,
      maxHotRegions: 6,
      candidateFamilies: [
        "onehop-all",
        "onehop-touch",
        "twohop-all",
        "twohop-touch",
      ],
      sectionSolver: {
        maxRipsWithoutMaxRegionCostImprovement: 2,
        extraRipsAfterBeatingBaselineMaxRegionCost: 0,
      },
    },
  },
  {
    name: "single-pass-hot6-all-families-beat-and-stop",
    config: {
      maxPasses: 1,
      maxHotRegions: 6,
      candidateFamilies: allFamilies,
      sectionSolver: {
        maxRipsWithoutMaxRegionCostImprovement: 2,
        extraRipsAfterBeatingBaselineMaxRegionCost: 0,
      },
    },
  },
]

const baselineResult = runSectionSolverBenchmark(legacySectionSolverBenchmarkConfig)
const baselineScore = baselineResult.summary.avgMaxRegionDelta
const baselineElapsedMs = baselineResult.summary.elapsedMs

const rows = [
  {
    variant: "legacy-baseline",
    avgMaxRegionDelta: baselineScore,
    scoreVsBaseline: 1,
    elapsedMs: baselineElapsedMs,
    speedupVsBaseline: 1,
    improvedSamples: baselineResult.summary.improvedSampleCount,
    candidateCount: baselineResult.summary.totalCandidateCount,
    solveGraphMs: baselineResult.summary.totalSolveGraphMs,
    candidateInitMs: baselineResult.summary.totalCandidateInitMs,
    candidateSolveMs: baselineResult.summary.totalCandidateSolveMs,
  },
]

for (const variant of variants) {
  const result = runSectionSolverBenchmark({
    ...defaultSectionSolverBenchmarkConfig,
    ...variant.config,
    sectionSolver: {
      ...defaultSectionSolverBenchmarkConfig.sectionSolver,
      ...variant.config.sectionSolver,
    },
  })

  rows.push({
    variant: variant.name,
    avgMaxRegionDelta: result.summary.avgMaxRegionDelta,
    scoreVsBaseline:
      baselineScore > 0
        ? Number((result.summary.avgMaxRegionDelta / baselineScore).toFixed(3))
        : 0,
    elapsedMs: result.summary.elapsedMs,
    speedupVsBaseline:
      result.summary.elapsedMs > 0
        ? Number((baselineElapsedMs / result.summary.elapsedMs).toFixed(2))
        : 0,
    improvedSamples: result.summary.improvedSampleCount,
    candidateCount: result.summary.totalCandidateCount,
    solveGraphMs: result.summary.totalSolveGraphMs,
    candidateInitMs: result.summary.totalCandidateInitMs,
    candidateSolveMs: result.summary.totalCandidateSolveMs,
  })
}

console.log("hg-07 first 40 section-solver profile sweep")
console.table(rows)
