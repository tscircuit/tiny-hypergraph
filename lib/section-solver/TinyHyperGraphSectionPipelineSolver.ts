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
import type { TinyHyperGraphUnravelSolverOptions } from "../unravel-solver"
import { TinyHyperGraphMultiSectionUnravelSolver } from "../unravel-solver"
import type { TinyHyperGraphSectionSolverOptions } from "./index"
import { getActiveSectionRouteIds, TinyHyperGraphSectionSolver } from "./index"

/**
 * Candidate section families used by the automatic section-mask search.
 *
 * Examples:
 * - `self-touch`: ports are included when they touch the single hottest region.
 * - `onehop-all`: ports are included only when all of their incident regions are
 *   inside the hottest region plus its immediate neighbors.
 * - `twohop-touch`: ports are included when they touch any region in the
 *   two-hop neighborhood around the hottest region.
 */
export type TinyHyperGraphSectionCandidateFamily =
  | "self-touch"
  | "onehop-all"
  | "onehop-touch"
  | "twohop-all"
  | "twohop-touch"

type SectionMaskCandidate = {
  /** Human-readable identifier used in logs, stats, and benchmark output. */
  label: string
  /** Candidate generation family that produced this section mask. */
  family: TinyHyperGraphSectionCandidateFamily
  /** Regions included in the candidate section before conversion to a port mask. */
  regionIds: RegionId[]
  /** Rule for deciding whether a port belongs in the section mask. */
  portSelectionRule: "touches-selected-region" | "all-incident-regions-selected"
}

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
}

const DEFAULT_SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_ITERATIONS: 1e6,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}

const DEFAULT_CANDIDATE_FAMILIES: TinyHyperGraphSectionCandidateFamily[] = [
  "self-touch",
  "onehop-all",
  "onehop-touch",
  "twohop-all",
  "twohop-touch",
]
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
      "self-touch": {
        label: `hot-${hotRegionId}-self-touch`,
        family: "self-touch",
        regionIds: [hotRegionId],
        portSelectionRule: "touches-selected-region",
      },
      "onehop-all": {
        label: `hot-${hotRegionId}-onehop-all`,
        family: "onehop-all",
        regionIds: oneHopRegionIds,
        portSelectionRule: "all-incident-regions-selected",
      },
      "onehop-touch": {
        label: `hot-${hotRegionId}-onehop-touch`,
        family: "onehop-touch",
        regionIds: oneHopRegionIds,
        portSelectionRule: "touches-selected-region",
      },
      "twohop-all": {
        label: `hot-${hotRegionId}-twohop-all`,
        family: "twohop-all",
        regionIds: twoHopRegionIds,
        portSelectionRule: "all-incident-regions-selected",
      },
      "twohop-touch": {
        label: `hot-${hotRegionId}-twohop-touch`,
        family: "twohop-touch",
        regionIds: twoHopRegionIds,
        portSelectionRule: "touches-selected-region",
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
    searchConfig?.candidateFamilies ?? DEFAULT_CANDIDATE_FAMILIES,
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
  unravelSolverOptions?: TinyHyperGraphUnravelSolverOptions
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
    {
      solverName: "unravel",
      solverClass: TinyHyperGraphMultiSectionUnravelSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) =>
        instance.getUnravelStageParams(),
      onSolved: (instance: TinyHyperGraphSectionPipelineSolver) =>
        instance.captureUnravelStageStats(),
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

  getUnravelStageParams(): [
    TinyHyperGraphTopology,
    TinyHyperGraphProblem,
    TinyHyperGraphSolution,
    TinyHyperGraphUnravelSolverOptions | undefined,
  ] {
    const optimizedSerializedHyperGraph =
      this.getStageOutput<SerializedHyperGraph>("optimizeSection")

    if (!optimizedSerializedHyperGraph) {
      throw new Error(
        "optimizeSection did not produce a solved serialized hypergraph",
      )
    }

    const { topology, problem, solution } = loadSerializedHyperGraph(
      optimizedSerializedHyperGraph,
    )

    return [topology, problem, solution, this.inputProblem.unravelSolverOptions]
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

  override _step() {
    const pipelineStageDef = this.pipelineDef[this.currentPipelineStageIndex]

    if (!pipelineStageDef) {
      this.solved = true
      return
    }

    if (this.activeSubSolver) {
      this.activeSubSolver.step()

      if (this.activeSubSolver.solved) {
        this.endTimeOfStage[pipelineStageDef.solverName] = performance.now()
        this.timeSpentOnStage[pipelineStageDef.solverName] =
          this.endTimeOfStage[pipelineStageDef.solverName]! -
          this.startTimeOfStage[pipelineStageDef.solverName]!

        const output = this.activeSubSolver.getOutput()
        if (output !== null) {
          this.pipelineOutputs[pipelineStageDef.solverName] = output
        }
        pipelineStageDef.onSolved?.(this)
        this.activeSubSolver = null
        this.currentPipelineStageIndex++

        if (!this.pipelineDef[this.currentPipelineStageIndex]) {
          this.solved = true
        }
      } else if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver.error
        this.failed = true
        this.activeSubSolver = null
      }
      return
    }

    const constructorParams = pipelineStageDef.getConstructorParams(this) as any[]
    const SolverClass = pipelineStageDef.solverClass as new (
      ...args: any[]
    ) => typeof this.activeSubSolver
    this.activeSubSolver = new SolverClass(...constructorParams)
    ;(this as unknown as Record<string, unknown>)[pipelineStageDef.solverName] =
      this.activeSubSolver
    this.timeSpentOnStage[pipelineStageDef.solverName] = 0
    this.startTimeOfStage[pipelineStageDef.solverName] = performance.now()
    this.firstIterationOfStage[pipelineStageDef.solverName] = this.iterations
  }

  captureUnravelStageStats() {
    const unravelSolver =
      this.getSolver<TinyHyperGraphMultiSectionUnravelSolver>("unravel")
    if (!unravelSolver) {
      return
    }

    this.stats = {
      ...this.stats,
      unravelSolverIterations: unravelSolver.iterations,
      unravelGeneratedCandidateCount:
        Number(unravelSolver.stats.generatedCandidateCount) || 0,
      unravelAttemptedCandidateCount:
        Number(unravelSolver.stats.attemptedCandidateCount) || 0,
      unravelSuccessfulMutationCount:
        Number(unravelSolver.stats.successfulMutationCount) || 0,
      unravelSearchStatesExpanded:
        Number(unravelSolver.stats.searchStatesExpanded) || 0,
      unravelSearchStatesQueued:
        Number(unravelSolver.stats.searchStatesQueued) || 0,
      unravelMutationDepth: Number(unravelSolver.stats.mutationDepth) || 0,
    }
  }

  override getStageStats() {
    const stageStats = super.getStageStats()

    for (const [stageIndex, stage] of this.pipelineDef.entries()) {
      const solverInstance = this.getSolver(stage.solverName)
      if (!solverInstance) {
        continue
      }

      const isCompleted = this.currentPipelineStageIndex > stageIndex
      const isInProgress =
        this.currentPipelineStageIndex === stageIndex &&
        this.activeSubSolver === solverInstance

      const startTime = this.startTimeOfStage[stage.solverName]
      const endTime = this.endTimeOfStage[stage.solverName]

      stageStats[stage.solverName] = {
        timeSpent: isCompleted
          ? this.timeSpentOnStage[stage.solverName] ?? 0
          : isInProgress && startTime !== undefined
            ? (endTime ?? performance.now()) - startTime
            : this.timeSpentOnStage[stage.solverName] ?? 0,
        iterations: solverInstance.iterations,
        completed: isCompleted,
      }
    }

    return stageStats
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
      this.getStageOutput<SerializedHyperGraph>("unravel") ??
      this.getStageOutput<SerializedHyperGraph>("optimizeSection") ??
      this.getStageOutput<SerializedHyperGraph>("solveGraph") ??
      null
    )
  }
}
