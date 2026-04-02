import { existsSync, readFileSync } from "node:fs"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSectionCandidateFamily,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolution,
  type TinyHyperGraphTopology,
} from "../../lib/index"

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

type ProfileMode = "pipeline-search" | "fixed-candidate"

const DEFAULT_INPUT_PATH =
  process.env.TINY_HYPERGRAPH_PORT_POINT_PATHING_INPUT ??
  "/Users/seve/Downloads/portPointPathingSolver_input (6).json"

const DEFAULT_CANDIDATE_FAMILIES: TinyHyperGraphSectionCandidateFamily[] = [
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]

const DEFAULT_SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_ITERATIONS: 1e6,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}

const datasetModule = datasetHg07 as DatasetModule

const parseStringArg = (flag: string) => {
  const argIndex = process.argv.findIndex((arg) => arg === flag)
  return argIndex === -1 ? undefined : process.argv[argIndex + 1]
}

const parsePositiveIntegerArg = (flag: string, fallback: number) => {
  const rawValue = parseStringArg(flag)
  if (!rawValue) {
    return fallback
  }

  const parsedValue = Number(rawValue)
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid ${flag} value: ${rawValue}`)
  }

  return parsedValue
}

const parseCandidateFamiliesArg = () => {
  const rawFamilies = parseStringArg("--families")
  if (!rawFamilies) {
    return DEFAULT_CANDIDATE_FAMILIES
  }

  return rawFamilies
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean) as TinyHyperGraphSectionCandidateFamily[]
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits))

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: number[],
) => {
  const adjacentRegionIds = new Set(seedRegionIds)

  for (const seedRegionId of seedRegionIds) {
    for (const portId of topology.regionIncidentPorts[seedRegionId] ?? []) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(regionId)
      }
    }
  }

  return [...adjacentRegionIds]
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: number[],
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (portSelectionRule === "touches-selected-region") {
      return incidentRegionIds.some((regionId) => selectedRegionIds.has(regionId))
        ? 1
        : 0
    }

    return incidentRegionIds.length > 0 &&
      incidentRegionIds.every((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const createProblemWithPortSectionMask = (
  problem: TinyHyperGraphProblem,
  portSectionMask: Int8Array,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask,
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
})

const getCandidatePortSectionMask = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  family: TinyHyperGraphSectionCandidateFamily,
  maxHotRegions: number,
  hotIndex = 0,
) => {
  const hotRegionIds = solvedSolver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, maxHotRegions)
    .map(({ regionId }) => regionId)

  const hotRegionId = hotRegionIds[hotIndex]
  if (hotRegionId === undefined) {
    throw new Error(`No hot region at index ${hotIndex}`)
  }

  const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])
  const twoHopRegionIds = getAdjacentRegionIds(topology, oneHopRegionIds)

  const candidateByFamily: Record<
    TinyHyperGraphSectionCandidateFamily,
    {
      label: string
      portSectionMask: Int8Array
    }
  > = {
    "self-touch": {
      label: `hot-${hotRegionId}-self-touch`,
      portSectionMask: createPortSectionMaskForRegionIds(
        topology,
        [hotRegionId],
        "touches-selected-region",
      ),
    },
    "onehop-all": {
      label: `hot-${hotRegionId}-onehop-all`,
      portSectionMask: createPortSectionMaskForRegionIds(
        topology,
        oneHopRegionIds,
        "all-incident-regions-selected",
      ),
    },
    "onehop-touch": {
      label: `hot-${hotRegionId}-onehop-touch`,
      portSectionMask: createPortSectionMaskForRegionIds(
        topology,
        oneHopRegionIds,
        "touches-selected-region",
      ),
    },
    "twohop-all": {
      label: `hot-${hotRegionId}-twohop-all`,
      portSectionMask: createPortSectionMaskForRegionIds(
        topology,
        twoHopRegionIds,
        "all-incident-regions-selected",
      ),
    },
    "twohop-touch": {
      label: `hot-${hotRegionId}-twohop-touch`,
      portSectionMask: createPortSectionMaskForRegionIds(
        topology,
        twoHopRegionIds,
        "touches-selected-region",
      ),
    },
  }

  return candidateByFamily[family]
}

const getSerializedInput = (): SerializedHyperGraph => {
  const source = parseStringArg("--source") ?? "attached"

  if (source === "attached") {
    const inputPath = parseStringArg("--input") ?? DEFAULT_INPUT_PATH
    if (!existsSync(inputPath)) {
      throw new Error(
        `Input file not found at ${inputPath}. Pass --input or set TINY_HYPERGRAPH_PORT_POINT_PATHING_INPUT.`,
      )
    }

    const input = JSON.parse(readFileSync(inputPath, "utf8"))
    return convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  }

  if (source === "hg07") {
    const sampleName = parseStringArg("--sample") ?? "sample032"
    const serializedHyperGraph = datasetModule[sampleName] as
      | SerializedHyperGraph
      | undefined
    if (!serializedHyperGraph) {
      throw new Error(`Unknown hg07 sample: ${sampleName}`)
    }
    return serializedHyperGraph
  }

  throw new Error(`Unknown --source value: ${source}`)
}

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSolvedReplayContext = (
  serializedHyperGraph: SerializedHyperGraph,
): {
  solvedSolver: TinyHyperGraphSolver
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
} => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solvedSolver = new TinyHyperGraphSolver(topology, problem)
  solvedSolver.solve()

  if (solvedSolver.failed || !solvedSolver.solved) {
    throw new Error(solvedSolver.error ?? "solveGraph failed unexpectedly")
  }

  const replay = loadSerializedHyperGraph(solvedSolver.getOutput())
  return {
    solvedSolver,
    topology: replay.topology,
    problem: replay.problem,
    solution: replay.solution,
  }
}

const runPipelineSearchProfile = (
  serializedHyperGraph: SerializedHyperGraph,
  repeatCount: number,
  maxHotRegions: number,
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[],
) => {
  const rows = []

  for (let runIndex = 0; runIndex < repeatCount; runIndex++) {
    const pipelineStartTime = performance.now()
    const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph,
      sectionSearchConfig: {
        maxHotRegions,
        candidateFamilies,
      },
    })
    pipelineSolver.solve()

    if (pipelineSolver.failed) {
      throw new Error(
        pipelineSolver.error ?? "section pipeline search failed unexpectedly",
      )
    }

    rows.push({
      run: runIndex + 1,
      pipelineMs: round(performance.now() - pipelineStartTime),
      sectionSearchMs: round(Number(pipelineSolver.stats.sectionSearchMs ?? 0)),
      candidateCount: Number(
        pipelineSolver.stats.sectionSearchCandidateCount ?? 0,
      ),
      family: pipelineSolver.selectedSectionCandidateFamily ?? null,
      label: pipelineSolver.selectedSectionCandidateLabel ?? null,
      finalMaxRegionCost: round(
        Number(pipelineSolver.stats.sectionSearchFinalMaxRegionCost ?? 0),
        12,
      ),
    })
  }

  console.log("section solver hotspot profile")
  console.log(
    JSON.stringify(
      {
        mode: "pipeline-search",
        repeatCount,
        maxHotRegions,
        candidateFamilies,
      },
      null,
      2,
    ),
  )
  console.table(rows)
}

const runFixedCandidateProfile = (
  serializedHyperGraph: SerializedHyperGraph,
  repeatCount: number,
  maxHotRegions: number,
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[],
) => {
  const context = getSolvedReplayContext(serializedHyperGraph)
  const selectionPipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph,
    sectionSearchConfig: {
      maxHotRegions,
      candidateFamilies,
    },
  })
  selectionPipeline.solve()

  if (selectionPipeline.failed || !selectionPipeline.selectedSectionMask) {
    throw new Error(
      selectionPipeline.error ??
        "section pipeline did not select a fixed candidate",
    )
  }

  const rows = []

  for (let runIndex = 0; runIndex < repeatCount; runIndex++) {
    const sectionSolver = new TinyHyperGraphSectionSolver(
      context.topology,
      createProblemWithPortSectionMask(
        context.problem,
        selectionPipeline.selectedSectionMask,
      ),
      context.solution,
      DEFAULT_SECTION_SOLVER_OPTIONS,
    )

    const startTime = performance.now()
    sectionSolver.solve()
    const elapsedMs = performance.now() - startTime

    if (sectionSolver.failed || !sectionSolver.solved) {
      throw new Error(
        sectionSolver.error ?? "fixed section candidate failed unexpectedly",
      )
    }

    rows.push({
      run: runIndex + 1,
      solveMs: round(elapsedMs),
      activeRouteCount: sectionSolver.activeRouteIds.length,
      ripCount: Number(sectionSolver.stats.ripCount ?? 0),
      optimized: Boolean(sectionSolver.stats.optimized),
      finalMaxRegionCost: round(
        Number(sectionSolver.stats.finalMaxRegionCost ?? 0),
        12,
      ),
      solvedMaxRegionCost: round(getMaxRegionCost(sectionSolver.getSolvedSolver()), 12),
    })
  }

  console.log("section solver hotspot profile")
  console.log(
    JSON.stringify(
      {
        mode: "fixed-candidate",
        repeatCount,
        maxHotRegions,
        candidateFamilies,
        selectedSectionCandidateFamily:
          selectionPipeline.selectedSectionCandidateFamily ?? null,
        selectedSectionCandidateLabel:
          selectionPipeline.selectedSectionCandidateLabel ?? null,
      },
      null,
      2,
    ),
  )
  console.table(rows)
}

const runExplicitCandidateProfile = (
  serializedHyperGraph: SerializedHyperGraph,
  repeatCount: number,
  maxHotRegions: number,
) => {
  const family = parseStringArg(
    "--candidate-family",
  ) as TinyHyperGraphSectionCandidateFamily | null
  if (!family) {
    throw new Error(
      "Explicit candidate mode requires --candidate-family <family>",
    )
  }

  const hotIndex = parsePositiveIntegerArg("--hot-index", 1) - 1
  const context = getSolvedReplayContext(serializedHyperGraph)
  const candidate = getCandidatePortSectionMask(
    context.solvedSolver,
    context.topology,
    family,
    maxHotRegions,
    hotIndex,
  )
  const rows = []

  for (let runIndex = 0; runIndex < repeatCount; runIndex++) {
    const sectionSolver = new TinyHyperGraphSectionSolver(
      context.topology,
      createProblemWithPortSectionMask(context.problem, candidate.portSectionMask),
      context.solution,
      DEFAULT_SECTION_SOLVER_OPTIONS,
    )

    const startTime = performance.now()
    sectionSolver.solve()
    const elapsedMs = performance.now() - startTime

    rows.push({
      run: runIndex + 1,
      solveMs: round(elapsedMs),
      activeRouteCount: sectionSolver.activeRouteIds.length,
      ripCount: Number(sectionSolver.stats.ripCount ?? 0),
      optimized: Boolean(sectionSolver.stats.optimized),
      finalMaxRegionCost: round(
        Number(sectionSolver.stats.finalMaxRegionCost ?? 0),
        12,
      ),
    })
  }

  console.log("section solver hotspot profile")
  console.log(
    JSON.stringify(
      {
        mode: "fixed-candidate",
        repeatCount,
        maxHotRegions,
        candidateFamily: family,
        candidateLabel: candidate.label,
      },
      null,
      2,
    ),
  )
  console.table(rows)
}

const mode = (parseStringArg("--mode") ?? "pipeline-search") as ProfileMode
const repeatCount = parsePositiveIntegerArg("--repeat", 3)
const maxHotRegions = parsePositiveIntegerArg("--max-hot-regions", 2)
const candidateFamilies = parseCandidateFamiliesArg()
const serializedHyperGraph = getSerializedInput()

if (parseStringArg("--candidate-family")) {
  runExplicitCandidateProfile(serializedHyperGraph, repeatCount, maxHotRegions)
} else if (mode === "pipeline-search") {
  runPipelineSearchProfile(
    serializedHyperGraph,
    repeatCount,
    maxHotRegions,
    candidateFamilies,
  )
} else if (mode === "fixed-candidate") {
  runFixedCandidateProfile(
    serializedHyperGraph,
    repeatCount,
    maxHotRegions,
    candidateFamilies,
  )
} else {
  throw new Error(`Unknown --mode value: ${mode}`)
}
