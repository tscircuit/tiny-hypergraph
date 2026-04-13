import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { cpus, tmpdir } from "node:os"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
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
  skipped: boolean
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

type ParallelSectionSearchWorkerInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions
  baselineMaxRegionCost: number
  candidates: SectionMaskCandidate[]
  doneSignal?: Int32Array
  resultPath?: string
}

type ParallelSectionSearchWorkerResult = {
  bestFinalMaxRegionCost: number
  bestPortSectionMask: Int8Array
  winningCandidateLabel?: string
  winningCandidateFamily?: TinyHyperGraphSectionCandidateFamily
  generatedCandidateCount: number
  candidateCount: number
  duplicateCandidateCount: number
  candidateEligibilityMs: number
  candidateInitMs: number
  candidateSolveMs: number
  candidateReplayScoreMs: number
  improvementEntries: ImprovementEntry[]
}

type ImprovementEntry = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: RegionId[]
  improvement: number
  portSectionMask: Int8Array
}

const shareInt32Array = (array: Int32Array) => {
  const shared = new Int32Array(new SharedArrayBuffer(array.byteLength))
  shared.set(array)
  return shared
}

const shareFloat64Array = (array: Float64Array) => {
  const shared = new Float64Array(new SharedArrayBuffer(array.byteLength))
  shared.set(array)
  return shared
}

const shareInt8Array = (array: Int8Array) => {
  const shared = new Int8Array(new SharedArrayBuffer(array.byteLength))
  shared.set(array)
  return shared
}

const createSharedWorkerTopology = (
  topology: TinyHyperGraphTopology,
): TinyHyperGraphTopology => ({
  ...topology,
  regionWidth: shareFloat64Array(topology.regionWidth),
  regionHeight: shareFloat64Array(topology.regionHeight),
  regionCenterX: shareFloat64Array(topology.regionCenterX),
  regionCenterY: shareFloat64Array(topology.regionCenterY),
  regionAvailableZMask: topology.regionAvailableZMask
    ? shareInt32Array(topology.regionAvailableZMask)
    : undefined,
  portAngleForRegion1: shareInt32Array(topology.portAngleForRegion1),
  portAngleForRegion2: topology.portAngleForRegion2
    ? shareInt32Array(topology.portAngleForRegion2)
    : undefined,
  portX: shareFloat64Array(topology.portX),
  portY: shareFloat64Array(topology.portY),
  portZ: shareInt32Array(topology.portZ),
})

const createSharedWorkerProblem = (
  problem: TinyHyperGraphProblem,
): TinyHyperGraphProblem => ({
  ...problem,
  portSectionMask: shareInt8Array(problem.portSectionMask),
  routeStartPort: shareInt32Array(problem.routeStartPort),
  routeEndPort: shareInt32Array(problem.routeEndPort),
  routeNet: shareInt32Array(problem.routeNet),
  regionNetId: shareInt32Array(problem.regionNetId),
})

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
const DEFAULT_MIN_BASELINE_MAX_REGION_COST_TO_SEARCH = 0.4

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
  routeStartPort: problem.routeStartPort,
  routeEndPort: problem.routeEndPort,
  routeNet: problem.routeNet,
  regionNetId: problem.regionNetId,
})

const getMergedMask = (portCount: number, masks: Int8Array[]) => {
  const merged = new Int8Array(portCount)

  for (const mask of masks) {
    for (let portId = 0; portId < portCount; portId++) {
      if (mask[portId] === 1) {
        merged[portId] = 1
      }
    }
  }

  return merged
}

const selectNonOverlappingImprovements = (
  portCount: number,
  improvements: ImprovementEntry[],
) => {
  const selectedRegionIds = new Set<RegionId>()
  const selected: ImprovementEntry[] = []

  for (const entry of improvements.sort(
    (left, right) => right.improvement - left.improvement,
  )) {
    if (entry.improvement <= IMPROVEMENT_EPSILON) {
      continue
    }

    if (entry.regionIds.some((regionId) => selectedRegionIds.has(regionId))) {
      continue
    }

    selected.push(entry)
    for (const regionId of entry.regionIds) {
      selectedRegionIds.add(regionId)
    }
  }

  return {
    selected,
    mergedMask: getMergedMask(
      portCount,
      selected.map((entry) => entry.portSectionMask),
    ),
  }
}

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

type CandidateChunkWorkerJob = {
  worker: Worker
  doneSignal: Int32Array
  tempDir: string
  resultPath: string
  error?: Error
}

const startCandidateChunkWorker = (
  input: ParallelSectionSearchWorkerInput,
): CandidateChunkWorkerJob => {
  const tempDir = mkdtempSync(join(tmpdir(), "section-worker-"))
  const resultPath = join(tempDir, "result.json")
  const doneSignal = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(
    new URL("./parallelSectionSearchWorker.ts", import.meta.url),
  )
  const job: CandidateChunkWorkerJob = {
    worker,
    doneSignal,
    tempDir,
    resultPath,
  }

  worker.on("error", (workerError) => {
    job.error = workerError as Error
    Atomics.store(doneSignal, 0, 1)
    Atomics.notify(doneSignal, 0)
  })
  worker.postMessage({ ...input, doneSignal, resultPath })
  return job
}

const finishCandidateChunkWorker = (
  job: CandidateChunkWorkerJob,
): ParallelSectionSearchWorkerResult => {
  const { doneSignal, worker, tempDir, resultPath } = job
  Atomics.wait(doneSignal, 0, 0)
  void worker.terminate()

  if (job.error) {
    rmSync(tempDir, { recursive: true, force: true })
    throw job.error
  }

  const parsedResult = JSON.parse(
    readFileSync(resultPath, "utf8"),
  ) as ParallelSectionSearchWorkerResult & {
    bestPortSectionMask: number[]
    improvementEntries: Array<Omit<ImprovementEntry, "portSectionMask"> & { portSectionMask: number[] }>
  }
  rmSync(tempDir, { recursive: true, force: true })

  return {
    ...parsedResult,
    bestPortSectionMask: Int8Array.from(parsedResult.bestPortSectionMask),
    improvementEntries: parsedResult.improvementEntries.map((entry) => ({
      ...entry,
      portSectionMask: Int8Array.from(entry.portSectionMask),
    })),
  }
}

const getWorkerCount = (candidateCount: number) =>
  Math.max(1, Math.min(candidateCount, cpus().length))

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
  const baselineMaxRegionCost = getMaxRegionCost(solvedSolver)
  const baselineEvaluationMs = performance.now() - baselineEvaluationStartTime
  const minBaselineMaxRegionCostToSearch =
    searchConfig?.minBaselineMaxRegionCostToSearch ??
    DEFAULT_MIN_BASELINE_MAX_REGION_COST_TO_SEARCH

  if (baselineMaxRegionCost < minBaselineMaxRegionCostToSearch) {
    return {
      skipped: true,
      portSectionMask: new Int8Array(topology.portCount),
      baselineMaxRegionCost,
      finalMaxRegionCost: baselineMaxRegionCost,
      generatedCandidateCount: 0,
      candidateCount: 0,
      duplicateCandidateCount: 0,
      totalMs: performance.now() - searchStartTime,
      baselineEvaluationMs,
      candidateEligibilityMs: 0,
      candidateInitMs: 0,
      candidateSolveMs: 0,
      candidateReplayScoreMs: 0,
    }
  }

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

  const uniqueCandidates: SectionMaskCandidate[] = []

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
    uniqueCandidates.push(candidate)
  }

  if (uniqueCandidates.length > 0) {
    try {
      const workerCount = getWorkerCount(uniqueCandidates.length)
      const chunkSize = Math.ceil(uniqueCandidates.length / workerCount)
      const workerInputs: ParallelSectionSearchWorkerInput[] = []
      const sharedTopology = createSharedWorkerTopology(topology)
      const sharedProblem = createSharedWorkerProblem(problem)

      for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
        const start = workerIndex * chunkSize
        const end = start + chunkSize
        const chunkCandidates = uniqueCandidates.slice(start, end)

        if (chunkCandidates.length === 0) {
          continue
        }

        workerInputs.push({
          topology: sharedTopology,
          problem: sharedProblem,
          solution,
          sectionSolverOptions,
          baselineMaxRegionCost,
          candidates: chunkCandidates,
        })
      }

      const workerJobs = workerInputs.map((workerInput) =>
        startCandidateChunkWorker(workerInput),
      )
      const workerResults = workerJobs.map((workerJob) =>
        finishCandidateChunkWorker(workerJob),
      )
      const improvements: ImprovementEntry[] = []

      for (const workerResult of workerResults) {
        candidateCount += workerResult.candidateCount
        duplicateCandidateCount += workerResult.duplicateCandidateCount
        candidateEligibilityMs += workerResult.candidateEligibilityMs
        candidateInitMs += workerResult.candidateInitMs
        candidateSolveMs += workerResult.candidateSolveMs
        candidateReplayScoreMs += workerResult.candidateReplayScoreMs
        improvements.push(...workerResult.improvementEntries)
      }

      const selected = selectNonOverlappingImprovements(
        topology.portCount,
        improvements,
      )

      if (selected.selected.length > 0) {
        bestPortSectionMask = selected.mergedMask
        const mergedProblem = createProblemWithPortSectionMask(
          problem,
          selected.mergedMask,
        )
        const mergedSectionSolver = new TinyHyperGraphSectionSolver(
          topology,
          mergedProblem,
          solution,
          sectionSolverOptions,
        )

        mergedSectionSolver.solve()

        if (mergedSectionSolver.solved && !mergedSectionSolver.failed) {
          bestFinalMaxRegionCost = getSerializedOutputMaxRegionCost(
            mergedSectionSolver.getOutput(),
          )
          const winner = selected.selected[0]
          winningCandidateLabel = winner?.label
          winningCandidateFamily = winner?.family
        }
      }
    } catch {
      // Fall back to baseline when worker-based parallel search fails.
    }
  }

  return {
    skipped: false,
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
  /**
   * Skip automatic section-search when the solved baseline max region cost is
   * already below this threshold. This avoids large overhead on easy circuits.
   */
  minBaselineMaxRegionCostToSearch?: number
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
  sectionSearchSkipped = false

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
          this.sectionSearchSkipped = searchResult.skipped
          this.stats = {
            ...this.stats,
            sectionSearchSkipped: searchResult.skipped,
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
    const solveGraphOutput =
      this.getStageOutput<SerializedHyperGraph>("solveGraph") ?? null
    const optimizeSectionOutput =
      this.getStageOutput<SerializedHyperGraph>("optimizeSection") ?? null

    if (!optimizeSectionOutput) {
      return solveGraphOutput
    }

    if (!solveGraphOutput) {
      return optimizeSectionOutput
    }

    if (this.sectionSearchSkipped) {
      return solveGraphOutput
    }

    const solveGraphMaxRegionCost = getSerializedOutputMaxRegionCost(
      solveGraphOutput,
    )
    const optimizeSectionMaxRegionCost = getSerializedOutputMaxRegionCost(
      optimizeSectionOutput,
    )

    return optimizeSectionMaxRegionCost <= solveGraphMaxRegionCost
      ? optimizeSectionOutput
      : solveGraphOutput
  }
}
