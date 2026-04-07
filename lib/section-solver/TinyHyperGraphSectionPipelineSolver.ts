import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
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

type PreparedSectionMaskCandidate = {
  candidate: SectionMaskCandidate
  candidateProblem: TinyHyperGraphProblem
}

type EvaluatedSectionMaskCandidate = {
  finalMaxRegionCost?: number
  candidateInitMs: number
  candidateSolveMs: number
  candidateReplayScoreMs: number
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
const DEFAULT_MAX_PARALLEL_CANDIDATES = Math.max(
  1,
  Math.min(4, availableParallelism()),
)

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
  const preparedCandidates: PreparedSectionMaskCandidate[] = []
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
      preparedCandidates.push({ candidate, candidateProblem })
    } catch {
      // Skip invalid section masks that split a route into multiple spans.
    }
  }

  const evaluatedCandidates = evaluateSectionMaskCandidates(
    topology,
    solution,
    preparedCandidates,
    sectionSolverOptions,
    searchConfig?.maxParallelCandidates ?? DEFAULT_MAX_PARALLEL_CANDIDATES,
  )

  for (let candidateIndex = 0; candidateIndex < preparedCandidates.length; candidateIndex++) {
    const preparedCandidate = preparedCandidates[candidateIndex]
    const evaluatedCandidate = evaluatedCandidates[candidateIndex]

    candidateInitMs += evaluatedCandidate?.candidateInitMs ?? 0
    candidateSolveMs += evaluatedCandidate?.candidateSolveMs ?? 0
    candidateReplayScoreMs += evaluatedCandidate?.candidateReplayScoreMs ?? 0

    const finalMaxRegionCost = evaluatedCandidate?.finalMaxRegionCost

    if (
      finalMaxRegionCost === undefined ||
      finalMaxRegionCost >= bestFinalMaxRegionCost - IMPROVEMENT_EPSILON
    ) {
      continue
    }

    bestFinalMaxRegionCost = finalMaxRegionCost
    bestPortSectionMask = new Int8Array(
      preparedCandidate!.candidateProblem.portSectionMask,
    )
    winningCandidateLabel = preparedCandidate!.candidate.label
    winningCandidateFamily = preparedCandidate!.candidate.family
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

const evaluateSectionMaskCandidates = (
  topology: TinyHyperGraphTopology,
  solution: TinyHyperGraphSolution,
  preparedCandidates: PreparedSectionMaskCandidate[],
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
  maxParallelCandidates: number,
): EvaluatedSectionMaskCandidate[] => {
  const boundedMaxParallelCandidates = Math.max(
    1,
    Math.floor(maxParallelCandidates),
  )

  if (
    preparedCandidates.length === 0 ||
    boundedMaxParallelCandidates === 1
  ) {
    return evaluateSectionMaskCandidatesSerial(
      topology,
      solution,
      preparedCandidates,
      sectionSolverOptions,
    )
  }

  return evaluateSectionMaskCandidatesParallel(
    topology,
    solution,
    preparedCandidates,
    sectionSolverOptions,
    boundedMaxParallelCandidates,
  )
}

const evaluateSectionMaskCandidatesSerial = (
  topology: TinyHyperGraphTopology,
  solution: TinyHyperGraphSolution,
  preparedCandidates: PreparedSectionMaskCandidate[],
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
): EvaluatedSectionMaskCandidate[] =>
  preparedCandidates.map(({ candidateProblem }) => {
    try {
      const candidateInitStartTime = performance.now()
      const sectionSolver = new TinyHyperGraphSectionSolver(
        topology,
        candidateProblem,
        solution,
        sectionSolverOptions,
      )
      const candidateInitMs = performance.now() - candidateInitStartTime

      const candidateSolveStartTime = performance.now()
      sectionSolver.solve()
      const candidateSolveMs = performance.now() - candidateSolveStartTime

      if (sectionSolver.failed || !sectionSolver.solved) {
        return {
          candidateInitMs,
          candidateSolveMs,
          candidateReplayScoreMs: 0,
        }
      }

      const candidateReplayScoreStartTime = performance.now()
      const finalMaxRegionCost = getSerializedOutputMaxRegionCost(
        sectionSolver.getOutput(),
      )
      const candidateReplayScoreMs =
        performance.now() - candidateReplayScoreStartTime

      return {
        finalMaxRegionCost,
        candidateInitMs,
        candidateSolveMs,
        candidateReplayScoreMs,
      }
    } catch {
      return {
        candidateInitMs: 0,
        candidateSolveMs: 0,
        candidateReplayScoreMs: 0,
      }
    }
  })

const evaluateSectionMaskCandidatesParallel = (
  topology: TinyHyperGraphTopology,
  solution: TinyHyperGraphSolution,
  preparedCandidates: PreparedSectionMaskCandidate[],
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
  maxParallelCandidates: number,
): EvaluatedSectionMaskCandidate[] => {
  const workerCount = Math.min(maxParallelCandidates, preparedCandidates.length)
  const notifySignal = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  )
  const statuses = new Int32Array(
    new SharedArrayBuffer(preparedCandidates.length * Int32Array.BYTES_PER_ELEMENT),
  )
  const candidateInitMs = new Float64Array(
    new SharedArrayBuffer(preparedCandidates.length * Float64Array.BYTES_PER_ELEMENT),
  )
  const candidateSolveMs = new Float64Array(
    new SharedArrayBuffer(preparedCandidates.length * Float64Array.BYTES_PER_ELEMENT),
  )
  const candidateReplayScoreMs = new Float64Array(
    new SharedArrayBuffer(preparedCandidates.length * Float64Array.BYTES_PER_ELEMENT),
  )
  const finalMaxRegionCosts = new Float64Array(
    new SharedArrayBuffer(preparedCandidates.length * Float64Array.BYTES_PER_ELEMENT),
  )
  finalMaxRegionCosts.fill(Number.NaN)

  const activeCandidateIndexes = new Set<number>()
  const completedCandidateIndexes = new Set<number>()
  let nextCandidateIndex = 0
  let completedCount = 0
  let observedNotifyCount = 0

  const startWorker = (candidateIndex: number) => {
    new Worker(new URL("./section-search-candidate-worker.ts", import.meta.url), {
      type: "module",
      workerData: {
        candidateIndex,
        topology,
        problem: preparedCandidates[candidateIndex]!.candidateProblem,
        solution,
        sectionSolverOptions,
        sharedBuffers: {
          notifySignal: notifySignal.buffer,
          statuses: statuses.buffer,
          candidateInitMs: candidateInitMs.buffer,
          candidateSolveMs: candidateSolveMs.buffer,
          candidateReplayScoreMs: candidateReplayScoreMs.buffer,
          finalMaxRegionCosts: finalMaxRegionCosts.buffer,
        },
      },
    })
    activeCandidateIndexes.add(candidateIndex)
  }

  while (
    nextCandidateIndex < preparedCandidates.length &&
    activeCandidateIndexes.size < workerCount
  ) {
    startWorker(nextCandidateIndex)
    nextCandidateIndex += 1
  }

  while (completedCount < preparedCandidates.length) {
    while (observedNotifyCount === Atomics.load(notifySignal, 0)) {
      Atomics.wait(notifySignal, 0, observedNotifyCount)
    }

    observedNotifyCount = Atomics.load(notifySignal, 0)

    for (const candidateIndex of activeCandidateIndexes) {
      if (completedCandidateIndexes.has(candidateIndex)) {
        continue
      }

      if (Atomics.load(statuses, candidateIndex) === 0) {
        continue
      }

      completedCandidateIndexes.add(candidateIndex)
      activeCandidateIndexes.delete(candidateIndex)
      completedCount += 1

      if (nextCandidateIndex < preparedCandidates.length) {
        startWorker(nextCandidateIndex)
        nextCandidateIndex += 1
      }
    }
  }

  return preparedCandidates.map((_, candidateIndex) => ({
    finalMaxRegionCost:
      Atomics.load(statuses, candidateIndex) === 1
        ? finalMaxRegionCosts[candidateIndex]
        : undefined,
    candidateInitMs: candidateInitMs[candidateIndex] ?? 0,
    candidateSolveMs: candidateSolveMs[candidateIndex] ?? 0,
    candidateReplayScoreMs: candidateReplayScoreMs[candidateIndex] ?? 0,
  }))
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
  /**
   * Safe MVP for automatic section search parallelism.
   * `1` preserves serial candidate evaluation; larger values use bounded
   * worker-based evaluation while keeping final winner selection deterministic.
   */
  maxParallelCandidates?: number
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
