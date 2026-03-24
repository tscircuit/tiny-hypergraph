import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../core"
import { TinyHyperGraphSolver } from "../core"
import type { RegionId } from "../types"
import type { TinyHyperGraphSectionSolverOptions } from "./index"
import { getActiveSectionRouteIds, TinyHyperGraphSectionSolver } from "./index"

export type TinyHyperGraphSectionCandidateFamily =
  | "self-any"
  | "onehop-both"
  | "onehop-any"
  | "twohop-both"
  | "twohop-any"

type SectionMaskCandidate = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: RegionId[]
  mode: "any" | "both"
}

type AutomaticSectionSearchResult = {
  portSectionMask: Int8Array
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  candidateCount: number
  winningCandidateLabel?: string
  winningCandidateFamily?: TinyHyperGraphSectionCandidateFamily
}

const DEFAULT_SOLVE_GRAPH_OPTIONS: TinyHyperGraphSolverOptions = {
  RIP_THRESHOLD_RAMP_ATTEMPTS: 50,
}

const DEFAULT_SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 50,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_ITERATIONS: 1e6,
  MAX_RIPS: Number.POSITIVE_INFINITY,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: Number.POSITIVE_INFINITY,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
    Number.POSITIVE_INFINITY,
}

const DEFAULT_CANDIDATE_FAMILIES: TinyHyperGraphSectionCandidateFamily[] = [
  "self-any",
  "onehop-both",
  "onehop-any",
  "twohop-both",
  "twohop-any",
]

const IMPROVEMENT_EPSILON = 1e-9

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
}

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: RegionId[],
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
  regionIds: RegionId[],
  mode: "any" | "both",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (mode === "any") {
      return incidentRegionIds.some((regionId) =>
        selectedRegionIds.has(regionId),
      )
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

const getSectionMaskCandidates = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  maxHotRegions: number,
  candidateFamilies: TinyHyperGraphSectionCandidateFamily[],
): SectionMaskCandidate[] => {
  const hotRegionIds = solvedSolver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, maxHotRegions)
    .map(({ regionId }) => regionId)

  const candidates: SectionMaskCandidate[] = []

  for (const hotRegionId of hotRegionIds) {
    const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])
    const twoHopRegionIds = getAdjacentRegionIds(topology, oneHopRegionIds)

    const candidateByFamily: Record<
      TinyHyperGraphSectionCandidateFamily,
      SectionMaskCandidate
    > = {
      "self-any": {
        label: `hot-${hotRegionId}-self-any`,
        family: "self-any",
        regionIds: [hotRegionId],
        mode: "any",
      },
      "onehop-both": {
        label: `hot-${hotRegionId}-onehop-both`,
        family: "onehop-both",
        regionIds: oneHopRegionIds,
        mode: "both",
      },
      "onehop-any": {
        label: `hot-${hotRegionId}-onehop-any`,
        family: "onehop-any",
        regionIds: oneHopRegionIds,
        mode: "any",
      },
      "twohop-both": {
        label: `hot-${hotRegionId}-twohop-both`,
        family: "twohop-both",
        regionIds: twoHopRegionIds,
        mode: "both",
      },
      "twohop-any": {
        label: `hot-${hotRegionId}-twohop-any`,
        family: "twohop-any",
        regionIds: twoHopRegionIds,
        mode: "any",
      },
    }

    for (const family of candidateFamilies) {
      candidates.push(candidateByFamily[family])
    }
  }

  return candidates
}

const findBestAutomaticSectionMask = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  searchConfig: TinyHyperGraphSectionPipelineSearchConfig | undefined,
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
): AutomaticSectionSearchResult => {
  const baselineSectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
    sectionSolverOptions,
  )
  const baselineMaxRegionCost = getMaxRegionCost(
    baselineSectionSolver.baselineSolver,
  )

  let bestFinalMaxRegionCost = baselineMaxRegionCost
  let bestPortSectionMask = new Int8Array(topology.portCount)
  let winningCandidateLabel: string | undefined
  let winningCandidateFamily: TinyHyperGraphSectionCandidateFamily | undefined
  let candidateCount = 0

  for (const candidate of getSectionMaskCandidates(
    solvedSolver,
    topology,
    searchConfig?.maxHotRegions ?? 9,
    searchConfig?.candidateFamilies ?? DEFAULT_CANDIDATE_FAMILIES,
  )) {
    const candidateProblem = createProblemWithPortSectionMask(
      problem,
      createPortSectionMaskForRegionIds(
        topology,
        candidate.regionIds,
        candidate.mode,
      ),
    )

    try {
      const activeRouteIds = getActiveSectionRouteIds(
        topology,
        candidateProblem,
        solution,
      )

      if (activeRouteIds.length === 0) {
        continue
      }

      candidateCount += 1

      const sectionSolver = new TinyHyperGraphSectionSolver(
        topology,
        candidateProblem,
        solution,
        sectionSolverOptions,
      )
      sectionSolver.solve()

      if (sectionSolver.failed || !sectionSolver.solved) {
        continue
      }

      const finalMaxRegionCost = getSerializedOutputMaxRegionCost(
        sectionSolver.getOutput(),
      )

      if (finalMaxRegionCost < bestFinalMaxRegionCost - IMPROVEMENT_EPSILON) {
        bestFinalMaxRegionCost = finalMaxRegionCost
        bestPortSectionMask = new Int8Array(candidateProblem.portSectionMask)
        winningCandidateLabel = candidate.label
        winningCandidateFamily = candidate.family
      }
    } catch {
      // Skip invalid section masks that split a route into multiple spans.
    }
  }

  return {
    portSectionMask: bestPortSectionMask,
    baselineMaxRegionCost,
    finalMaxRegionCost: bestFinalMaxRegionCost,
    candidateCount,
    winningCandidateLabel,
    winningCandidateFamily,
  }
}

export interface TinyHyperGraphSectionMaskContext {
  serializedHyperGraph: SerializedHyperGraph
  solvedSerializedHyperGraph: SerializedHyperGraph
  solvedSolver: TinyHyperGraphSolver
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
}

export interface TinyHyperGraphSectionPipelineSearchConfig {
  maxHotRegions?: number
  candidateFamilies?: TinyHyperGraphSectionCandidateFamily[]
}

export interface TinyHyperGraphSectionPipelineInput {
  serializedHyperGraph: SerializedHyperGraph
  createSectionMask?: (context: TinyHyperGraphSectionMaskContext) => Int8Array
  solveGraphOptions?: TinyHyperGraphSolverOptions
  sectionSolverOptions?: TinyHyperGraphSectionSolverOptions
  sectionSearchConfig?: TinyHyperGraphSectionPipelineSearchConfig
}

export class TinyHyperGraphSectionPipelineSolver extends BasePipelineSolver<TinyHyperGraphSectionPipelineInput> {
  initialVisualizationSolver?: TinyHyperGraphSolver
  selectedSectionMask?: Int8Array
  selectedSectionCandidateLabel?: string
  selectedSectionCandidateFamily?: TinyHyperGraphSectionCandidateFamily

  override pipelineDef = [
    {
      solverName: "solveGraph",
      solverClass: TinyHyperGraphSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) => {
        const { topology, problem } = loadSerializedHyperGraph(
          instance.inputProblem.serializedHyperGraph,
        )

        return [
          topology,
          problem,
          {
            ...DEFAULT_SOLVE_GRAPH_OPTIONS,
            ...instance.inputProblem.solveGraphOptions,
          },
        ] as ConstructorParameters<typeof TinyHyperGraphSolver>
      },
    },
    {
      solverName: "optimizeSection",
      solverClass: TinyHyperGraphSectionSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) =>
        instance.getSectionStageParams(),
    },
  ]

  getSectionStageParams(): [
    TinyHyperGraphTopology,
    TinyHyperGraphProblem,
    TinyHyperGraphSolution,
    TinyHyperGraphSectionSolverOptions,
  ] {
    const solvedSerializedHyperGraph =
      this.getStageOutput<SerializedHyperGraph>("solveGraph")

    if (!solvedSerializedHyperGraph) {
      throw new Error(
        "solveGraph did not produce a solved serialized hypergraph",
      )
    }

    const solvedSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")

    if (!solvedSolver) {
      throw new Error("solveGraph solver is unavailable")
    }

    const sectionSolverOptions = {
      ...DEFAULT_SECTION_SOLVER_OPTIONS,
      ...this.inputProblem.sectionSolverOptions,
    }
    const { topology, problem, solution } = loadSerializedHyperGraph(
      solvedSerializedHyperGraph,
    )

    const portSectionMask = this.inputProblem.createSectionMask
      ? this.inputProblem.createSectionMask({
          serializedHyperGraph: this.inputProblem.serializedHyperGraph,
          solvedSerializedHyperGraph,
          solvedSolver,
          topology,
          problem,
          solution,
        })
      : (() => {
          const searchResult = findBestAutomaticSectionMask(
            solvedSolver,
            topology,
            problem,
            solution,
            this.inputProblem.sectionSearchConfig,
            sectionSolverOptions,
          )

          this.selectedSectionCandidateLabel =
            searchResult.winningCandidateLabel
          this.selectedSectionCandidateFamily =
            searchResult.winningCandidateFamily
          this.stats = {
            ...this.stats,
            sectionSearchCandidateCount: searchResult.candidateCount,
            sectionSearchBaselineMaxRegionCost:
              searchResult.baselineMaxRegionCost,
            sectionSearchFinalMaxRegionCost: searchResult.finalMaxRegionCost,
            sectionSearchDelta:
              searchResult.baselineMaxRegionCost -
              searchResult.finalMaxRegionCost,
            selectedSectionCandidateLabel:
              searchResult.winningCandidateLabel ?? null,
            selectedSectionCandidateFamily:
              searchResult.winningCandidateFamily ?? null,
          }

          return searchResult.portSectionMask
        })()

    this.selectedSectionMask = new Int8Array(portSectionMask)
    problem.portSectionMask = new Int8Array(portSectionMask)

    this.stats = {
      ...this.stats,
      sectionMaskPortCount: [...portSectionMask].filter((value) => value === 1)
        .length,
    }

    return [topology, problem, solution, sectionSolverOptions]
  }

  getInitialVisualizationSolver() {
    if (!this.initialVisualizationSolver) {
      const { topology, problem } = loadSerializedHyperGraph(
        this.inputProblem.serializedHyperGraph,
      )
      this.initialVisualizationSolver = new TinyHyperGraphSolver(
        topology,
        problem,
      )
    }

    return this.initialVisualizationSolver
  }

  override initialVisualize() {
    return this.getInitialVisualizationSolver().visualize()
  }

  override visualize(): GraphicsObject {
    if (this.iterations === 0) {
      return this.initialVisualize() ?? super.visualize()
    }

    return super.visualize()
  }

  override getOutput() {
    return (
      this.getStageOutput<SerializedHyperGraph>("optimizeSection") ??
      this.getStageOutput<SerializedHyperGraph>("solveGraph") ??
      null
    )
  }
}
