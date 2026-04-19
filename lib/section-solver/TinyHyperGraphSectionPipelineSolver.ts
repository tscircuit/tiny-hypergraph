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
import {
  createSectionMaskCandidatesForHotRegions,
  DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  type TinyHyperGraphSectionCandidateFamily,
  type TinyHyperGraphSectionMaskCandidate,
} from "./sectionCandidateFamilies"

export {
  ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
  type TinyHyperGraphSectionCandidateFamily,
} from "./sectionCandidateFamilies"

type AutomaticSectionSearchResult = {
  portSectionMask: Int8Array
  baselineMaxRegionCost: number
  finalMaxRegionCost: number
  generatedCandidateCount: number
  candidateCount: number
  duplicateCandidateCount: number
  totalMs: number
  baselineEvaluationMs: number
  candidateEligibilityMs: number
  candidateInitMs: number
  candidateSolveMs: number
  candidateReplayScoreMs: number
  winningCandidateLabel?: string
  winningCandidateFamily?: TinyHyperGraphSectionCandidateFamily
}

const DEFAULT_SOLVE_GRAPH_OPTIONS: TinyHyperGraphSolverOptions = {
  RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
  RIP_COST_START: 0.1,
  RIP_COST_END: 0.16,
  RIPS_UNTIL_RIP_COST_MAX: 4,
}

const DEFAULT_SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
  RIP_COST_START: 0.1,
  RIP_COST_END: 0.16,
  RIPS_UNTIL_RIP_COST_MAX: 4,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_ITERATIONS: 1e6,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}

const DEFAULT_MAX_HOT_REGIONS = 2

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

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: RegionId[],
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (portSelectionRule === "touches-selected-region") {
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
): TinyHyperGraphSectionMaskCandidate[] => {
  const hotRegionIds = solvedSolver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      regionCost: regionIntersectionCache.existingRegionCost,
    }))
    .filter(({ regionCost }) => regionCost > 0)
    .sort((left, right) => right.regionCost - left.regionCost)
    .slice(0, maxHotRegions)
    .map(({ regionId }) => regionId)

  return createSectionMaskCandidatesForHotRegions(
    topology,
    hotRegionIds,
    candidateFamilies,
  )
}

const findBestAutomaticSectionMask = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  searchConfig: TinyHyperGraphSectionPipelineSearchConfig | undefined,
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
): AutomaticSectionSearchResult => {
  const searchStartTime = performance.now()
  const baselineEvaluationStartTime = performance.now()
  const baselineSectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
    sectionSolverOptions,
  )
  const baselineMaxRegionCost = getMaxRegionCost(
    baselineSectionSolver.baselineSolver,
  )
  const baselineEvaluationMs = performance.now() - baselineEvaluationStartTime

  let bestFinalMaxRegionCost = baselineMaxRegionCost
  let bestPortSectionMask = new Int8Array(topology.portCount)
  let winningCandidateLabel: string | undefined
  let winningCandidateFamily: TinyHyperGraphSectionCandidateFamily | undefined
  let generatedCandidateCount = 0
  let candidateCount = 0
  let duplicateCandidateCount = 0
  let candidateEligibilityMs = 0
  let candidateInitMs = 0
  let candidateSolveMs = 0
  let candidateReplayScoreMs = 0
  const seenPortSectionMasks = new Set<string>()
  const maxHotRegions =
    searchConfig?.maxHotRegions ??
    sectionSolverOptions.MAX_HOT_REGIONS ??
    DEFAULT_MAX_HOT_REGIONS

  for (const candidate of getSectionMaskCandidates(
    solvedSolver,
    topology,
    maxHotRegions,
    searchConfig?.candidateFamilies ?? [
      ...DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES,
    ],
  )) {
    const candidateProblem = createProblemWithPortSectionMask(
      problem,
      createPortSectionMaskForRegionIds(
        topology,
        candidate.regionIds,
        candidate.portSelectionRule,
      ),
    )
    generatedCandidateCount += 1
    const portSectionMaskKey = candidateProblem.portSectionMask.join(",")

    if (seenPortSectionMasks.has(portSectionMaskKey)) {
      duplicateCandidateCount += 1
      continue
    }

    seenPortSectionMasks.add(portSectionMaskKey)

    try {
      const eligibilityStartTime = performance.now()
      const activeRouteIds = getActiveSectionRouteIds(
        topology,
        candidateProblem,
        solution,
      )
      candidateEligibilityMs += performance.now() - eligibilityStartTime

      if (activeRouteIds.length === 0) {
        continue
      }

      candidateCount += 1

      const candidateInitStartTime = performance.now()
      const sectionSolver = new TinyHyperGraphSectionSolver(
        topology,
        candidateProblem,
        solution,
        sectionSolverOptions,
      )
      candidateInitMs += performance.now() - candidateInitStartTime

      const candidateSolveStartTime = performance.now()
      sectionSolver.solve()
      candidateSolveMs += performance.now() - candidateSolveStartTime

      if (sectionSolver.failed || !sectionSolver.solved) {
        continue
      }

      const finalMaxRegionCost = Number(
        sectionSolver.stats.finalMaxRegionCost ??
          getMaxRegionCost(sectionSolver.getSolvedSolver()),
      )

      if (finalMaxRegionCost < bestFinalMaxRegionCost - IMPROVEMENT_EPSILON) {
        const candidateReplayScoreStartTime = performance.now()
        const replayedFinalMaxRegionCost = getSerializedOutputMaxRegionCost(
          sectionSolver.getOutput(),
        )
        candidateReplayScoreMs +=
          performance.now() - candidateReplayScoreStartTime

        if (
          replayedFinalMaxRegionCost <
          bestFinalMaxRegionCost - IMPROVEMENT_EPSILON
        ) {
          bestFinalMaxRegionCost = replayedFinalMaxRegionCost
          bestPortSectionMask = new Int8Array(candidateProblem.portSectionMask)
          winningCandidateLabel = candidate.label
          winningCandidateFamily = candidate.family
        }
      }
    } catch {
      // Skip invalid section masks that split a route into multiple spans.
    }
  }

  return {
    portSectionMask: bestPortSectionMask,
    baselineMaxRegionCost,
    finalMaxRegionCost: bestFinalMaxRegionCost,
    generatedCandidateCount,
    candidateCount,
    duplicateCandidateCount,
    totalMs: performance.now() - searchStartTime,
    baselineEvaluationMs,
    candidateEligibilityMs,
    candidateInitMs,
    candidateSolveMs,
    candidateReplayScoreMs,
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
            sectionSearchGeneratedCandidateCount:
              searchResult.generatedCandidateCount,
            sectionSearchCandidateCount: searchResult.candidateCount,
            sectionSearchDuplicateCandidateCount:
              searchResult.duplicateCandidateCount,
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
            sectionSearchMs: searchResult.totalMs,
            sectionSearchBaselineEvaluationMs:
              searchResult.baselineEvaluationMs,
            sectionSearchCandidateEligibilityMs:
              searchResult.candidateEligibilityMs,
            sectionSearchCandidateInitMs: searchResult.candidateInitMs,
            sectionSearchCandidateSolveMs: searchResult.candidateSolveMs,
            sectionSearchCandidateReplayScoreMs:
              searchResult.candidateReplayScoreMs,
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
