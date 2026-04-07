import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
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
import {
  cloneRegionSegments,
  createSolvedSolverFromRegionSegments,
  createSolvedSolverFromSolution,
  getActiveSectionRouteIds,
  TinyHyperGraphSectionSolver,
} from "./index"

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
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: RegionId[]
  portSelectionRule: "touches-selected-region" | "all-incident-regions-selected"
}

type RegionCostSummary = {
  maxRegionCost: number
  totalRegionCost: number
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

type MultiSectionWorkerJob = {
  serializedHyperGraph: SerializedHyperGraph
  candidate: SectionMaskCandidate
  portSectionMask: Int8Array
  activeRouteIds: number[]
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions
}

type MultiSectionCandidateResult = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  portSectionMask: Int8Array
  touchedRegionIds: RegionId[]
  touchedRouteIds: number[]
  finalSummary: RegionCostSummary
  output: SerializedHyperGraph
}

type MultiSectionRoundResult = {
  serializedHyperGraph: SerializedHyperGraph
  portSectionMask: Int8Array
  finalSummary: RegionCostSummary
  generatedCandidateCount: number
  candidateCount: number
  duplicateCandidateCount: number
  totalMs: number
  baselineEvaluationMs: number
  candidateEligibilityMs: number
  candidateInitMs: number
  candidateSolveMs: number
  candidateReplayScoreMs: number
  acceptedCandidateCount: number
  roundCount: number
  workerCount: number
  acceptedCandidateLabels: string[]
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
const DEFAULT_MULTI_SECTION_MAX_ROUNDS = 2
const MAX_MULTI_SECTION_WORKERS = 4
const IMPROVEMENT_EPSILON = 1e-9
const require = createRequire(import.meta.url)

const summarizeRegionIntersectionCaches = (
  regionIntersectionCaches: TinyHyperGraphSolver["state"]["regionIntersectionCaches"],
): RegionCostSummary => {
  let maxRegionCost = 0
  let totalRegionCost = 0

  for (const regionIntersectionCache of regionIntersectionCaches) {
    const regionCost = regionIntersectionCache.existingRegionCost
    maxRegionCost = Math.max(maxRegionCost, regionCost)
    totalRegionCost += regionCost
  }

  return {
    maxRegionCost,
    totalRegionCost,
  }
}

const compareRegionCostSummaries = (
  left: RegionCostSummary,
  right: RegionCostSummary,
) => {
  if (Math.abs(left.maxRegionCost - right.maxRegionCost) > IMPROVEMENT_EPSILON) {
    return left.maxRegionCost - right.maxRegionCost
  }

  if (
    Math.abs(left.totalRegionCost - right.totalRegionCost) >
    IMPROVEMENT_EPSILON
  ) {
    return left.totalRegionCost - right.totalRegionCost
  }

  return 0
}

const getSolverRegionCostSummary = (
  solver: TinyHyperGraphSolver,
): RegionCostSummary =>
  summarizeRegionIntersectionCaches(solver.state.regionIntersectionCaches)

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  getSolverRegionCostSummary(solver).maxRegionCost

const getSerializedOutputSummary = (
  serializedHyperGraph: SerializedHyperGraph,
): RegionCostSummary => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getSolverRegionCostSummary(replayedSolver.baselineSolver)
}

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: SerializedHyperGraph,
) => getSerializedOutputSummary(serializedHyperGraph).maxRegionCost

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
    .sort(
      (left, right) =>
        right.regionCost - left.regionCost || left.regionId - right.regionId,
    )
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

const masksClash = (
  acceptedRegionIds: Set<RegionId>,
  candidateRegionIds: RegionId[],
) => candidateRegionIds.some((regionId) => acceptedRegionIds.has(regionId))

const routesClash = (
  acceptedRouteIds: Set<number>,
  candidateRouteIds: number[],
) => candidateRouteIds.some((routeId) => acceptedRouteIds.has(routeId))

const createUnionPortSectionMask = (
  topology: TinyHyperGraphTopology,
  candidateResults: Array<Pick<MultiSectionCandidateResult, "portSectionMask">>,
) => {
  const unionMask = new Int8Array(topology.portCount)

  for (const candidateResult of candidateResults) {
    for (let portId = 0; portId < unionMask.length; portId++) {
      if (candidateResult.portSectionMask[portId] === 1) {
        unionMask[portId] = 1
      }
    }
  }

  return unionMask
}

const mergeMultiSectionCandidateOutputs = (
  currentSerializedHyperGraph: SerializedHyperGraph,
  acceptedCandidates: MultiSectionCandidateResult[],
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
) => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    currentSerializedHyperGraph,
  )
  const baselineSolver = createSolvedSolverFromSolution(
    topology,
    problem,
    solution,
    sectionSolverOptions,
  )
  const mergedRegionSegments = cloneRegionSegments(
    baselineSolver.state.regionSegments,
  )

  for (const acceptedCandidate of acceptedCandidates) {
    const candidateReplay = loadSerializedHyperGraph(acceptedCandidate.output)
    const candidateSolver = createSolvedSolverFromSolution(
      candidateReplay.topology,
      candidateReplay.problem,
      candidateReplay.solution,
      sectionSolverOptions,
    )

    for (const regionId of acceptedCandidate.touchedRegionIds) {
      mergedRegionSegments[regionId] = cloneRegionSegments([
        candidateSolver.state.regionSegments[regionId] ?? [],
      ])[0]!
    }
  }

  const mergedSolver = createSolvedSolverFromRegionSegments(
    topology,
    problem,
    mergedRegionSegments,
    sectionSolverOptions,
  )

  return {
    serializedHyperGraph: mergedSolver.getOutput(),
    finalSummary: getSolverRegionCostSummary(mergedSolver),
    portSectionMask: createUnionPortSectionMask(topology, acceptedCandidates),
  }
}

const runMultiSectionWorkerPool = (
  jobs: MultiSectionWorkerJob[],
  workerCount: number,
): MultiSectionCandidateResult[] => {
  if (jobs.length === 0) {
    return []
  }

  let WorkerCtor: typeof import("node:worker_threads").Worker

  try {
    ;({ Worker: WorkerCtor } = require("node:worker_threads"))
  } catch {
    WorkerCtor = undefined as never
  }

  if (!WorkerCtor || workerCount <= 1) {
    const fallbackResults = jobs.map((job) => {
        const replay = loadSerializedHyperGraph(job.serializedHyperGraph)
        const candidateProblem = createProblemWithPortSectionMask(
          replay.problem,
          new Int8Array(job.portSectionMask),
        )
        const sectionSolver = new TinyHyperGraphSectionSolver(
          replay.topology,
          candidateProblem,
          replay.solution,
          job.sectionSolverOptions,
        )
        sectionSolver.solve()

        if (sectionSolver.failed || !sectionSolver.solved) {
          return null
        }

        const output = sectionSolver.getOutput()

        return {
          label: job.candidate.label,
          family: job.candidate.family,
          portSectionMask: new Int8Array(job.portSectionMask),
          touchedRegionIds: [...job.candidate.regionIds].sort((a, b) => a - b),
          touchedRouteIds: [...job.activeRouteIds].sort((a, b) => a - b),
          finalSummary: getSerializedOutputSummary(output),
          output,
        } as MultiSectionCandidateResult
      })
    return fallbackResults.filter(Boolean) as MultiSectionCandidateResult[]
  }

  const tempDir = mkdtempSync(join(tmpdir(), "tiny-hypergraph-multi-section-"))
  const status = new Int32Array(new SharedArrayBuffer(workerCount * Int32Array.BYTES_PER_ELEMENT))
  const workerSlots = new Array<
    | {
        jobIndex: number
        outputPath: string
        worker: InstanceType<typeof WorkerCtor>
      }
    | undefined
  >(workerCount)
  const results: MultiSectionCandidateResult[] = []
  let nextJobIndex = 0
  let activeWorkerCount = 0

  const spawnJobInSlot = (slotIndex: number) => {
    if (nextJobIndex >= jobs.length) {
      return
    }

    const jobIndex = nextJobIndex++
    const outputPath = join(tempDir, `worker-${slotIndex}-job-${jobIndex}.json`)
    const worker = new WorkerCtor(
      new URL("./multiSectionRoundWorker.ts", import.meta.url),
      {
        workerData: {
          job: jobs[jobIndex],
          outputPath,
          sharedBuffer: status.buffer,
          slotIndex,
        },
      },
    )

    Atomics.store(status, slotIndex, 0)
    workerSlots[slotIndex] = {
      jobIndex,
      outputPath,
      worker,
    }
    activeWorkerCount += 1
  }

  try {
    for (
      let slotIndex = 0;
      slotIndex < workerCount && slotIndex < jobs.length;
      slotIndex++
    ) {
      spawnJobInSlot(slotIndex)
    }

    while (activeWorkerCount > 0) {
      let finishedSlotIndex = -1

      while (finishedSlotIndex === -1) {
        for (let slotIndex = 0; slotIndex < workerCount; slotIndex++) {
          if (Atomics.load(status, slotIndex) === 1) {
            finishedSlotIndex = slotIndex
            break
          }
        }

        if (finishedSlotIndex === -1) {
          Atomics.wait(status, 0, 0, 10)
        }
      }

      const slot = workerSlots[finishedSlotIndex]
      if (!slot) {
        Atomics.store(status, finishedSlotIndex, 0)
        continue
      }

      const payload = JSON.parse(readFileSync(slot.outputPath, "utf8")) as
        | { ok: true; result: MultiSectionCandidateResult }
        | { ok: false; error: string }

      slot.worker.terminate()
      workerSlots[finishedSlotIndex] = undefined
      Atomics.store(status, finishedSlotIndex, 0)
      activeWorkerCount -= 1

      if (payload.ok) {
        results.push({
          ...payload.result,
          portSectionMask: new Int8Array(payload.result.portSectionMask),
        })
      }

      spawnJobInSlot(finishedSlotIndex)
    }
  } finally {
    for (const slot of workerSlots) {
      slot?.worker.terminate()
    }
    rmSync(tempDir, { recursive: true, force: true })
  }

  return results
}

const findBestMultiSectionRound = (
  solvedSerializedHyperGraph: SerializedHyperGraph,
  searchConfig: TinyHyperGraphSectionPipelineSearchConfig | undefined,
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions,
): MultiSectionRoundResult => {
  const searchStartTime = performance.now()
  let generatedCandidateCount = 0
  let candidateCount = 0
  let duplicateCandidateCount = 0
  let candidateEligibilityMs = 0
  let candidateInitMs = 0
  let candidateSolveMs = 0
  let candidateReplayScoreMs = 0
  const acceptedCandidateLabels: string[] = []
  const maxRounds = Math.max(
    1,
    searchConfig?.multiSectionRoundConfig?.maxRounds ??
      DEFAULT_MULTI_SECTION_MAX_ROUNDS,
  )
  const workerCount = Math.max(
    1,
    Math.min(
      MAX_MULTI_SECTION_WORKERS,
      searchConfig?.multiSectionRoundConfig?.maxWorkers ??
        MAX_MULTI_SECTION_WORKERS,
    ),
  )
  let roundCount = 0
  let currentSerializedHyperGraph = solvedSerializedHyperGraph
  let currentPortSectionMask = new Int8Array(0)
  const baselineEvaluationStartTime = performance.now()
  let currentSummary = getSerializedOutputSummary(currentSerializedHyperGraph)
  const baselineEvaluationMs = performance.now() - baselineEvaluationStartTime

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex++) {
    roundCount = roundIndex + 1
    const { topology, problem, solution } = loadSerializedHyperGraph(
      currentSerializedHyperGraph,
    )
    const solvedSolver = createSolvedSolverFromSolution(
      topology,
      problem,
      solution,
      sectionSolverOptions,
    )
    const maxHotRegions =
      searchConfig?.maxHotRegions ??
      sectionSolverOptions.MAX_HOT_REGIONS ??
      DEFAULT_MAX_HOT_REGIONS
    const seenPortSectionMasks = new Set<string>()
    const workerJobs: MultiSectionWorkerJob[] = []

    for (const candidate of getSectionMaskCandidates(
      solvedSolver,
      topology,
      maxHotRegions,
      searchConfig?.candidateFamilies ?? DEFAULT_CANDIDATE_FAMILIES,
    )) {
      const portSectionMask = createPortSectionMaskForRegionIds(
        topology,
        candidate.regionIds,
        candidate.portSelectionRule,
      )
      generatedCandidateCount += 1
      const portSectionMaskKey = portSectionMask.join(",")

      if (seenPortSectionMasks.has(portSectionMaskKey)) {
        duplicateCandidateCount += 1
        continue
      }

      seenPortSectionMasks.add(portSectionMaskKey)

      try {
        const eligibilityStartTime = performance.now()
        const activeRouteIds = getActiveSectionRouteIds(
          topology,
          createProblemWithPortSectionMask(problem, portSectionMask),
          solution,
        )
        candidateEligibilityMs += performance.now() - eligibilityStartTime

        if (activeRouteIds.length === 0) {
          continue
        }

        candidateCount += 1
        workerJobs.push({
          serializedHyperGraph: currentSerializedHyperGraph,
          candidate,
          portSectionMask,
          activeRouteIds,
          sectionSolverOptions,
        })
      } catch {
        // Skip invalid section masks that split a route into multiple spans.
      }
    }

    if (workerJobs.length === 0) {
      break
    }

    const solveStartTime = performance.now()
    const candidateResults = runMultiSectionWorkerPool(workerJobs, workerCount)
    const solveDurationMs = performance.now() - solveStartTime
    candidateSolveMs += solveDurationMs

    const improvingResults = candidateResults
      .filter(
        (candidateResult) =>
          compareRegionCostSummaries(candidateResult.finalSummary, currentSummary) <
          0,
      )
      .sort(
        (left, right) =>
          compareRegionCostSummaries(left.finalSummary, right.finalSummary) ||
          left.label.localeCompare(right.label),
      )

    const acceptedRegionIds = new Set<RegionId>()
    const acceptedRouteIds = new Set<number>()
    const acceptedCandidates: MultiSectionCandidateResult[] = []

    for (const improvingResult of improvingResults) {
      if (
        masksClash(acceptedRegionIds, improvingResult.touchedRegionIds) ||
        routesClash(acceptedRouteIds, improvingResult.touchedRouteIds)
      ) {
        continue
      }

      acceptedCandidates.push(improvingResult)

      for (const regionId of improvingResult.touchedRegionIds) {
        acceptedRegionIds.add(regionId)
      }
      for (const routeId of improvingResult.touchedRouteIds) {
        acceptedRouteIds.add(routeId)
      }
    }

    if (acceptedCandidates.length === 0) {
      break
    }

    let mergedRound:
      | ReturnType<typeof mergeMultiSectionCandidateOutputs>
      | undefined
    const mergeStartTime = performance.now()
    try {
      mergedRound = mergeMultiSectionCandidateOutputs(
        currentSerializedHyperGraph,
        acceptedCandidates,
        sectionSolverOptions,
      )
    } catch {
      mergedRound = undefined
    }
    candidateReplayScoreMs += performance.now() - mergeStartTime

    if (!mergedRound) {
      break
    }

    if (compareRegionCostSummaries(mergedRound.finalSummary, currentSummary) >= 0) {
      break
    }

    currentSerializedHyperGraph = mergedRound.serializedHyperGraph
    currentSummary = mergedRound.finalSummary
    currentPortSectionMask = mergedRound.portSectionMask
    acceptedCandidateLabels.push(
      ...acceptedCandidates.map((candidate) => candidate.label),
    )
  }

  return {
    serializedHyperGraph: currentSerializedHyperGraph,
    portSectionMask: currentPortSectionMask,
    finalSummary: currentSummary,
    generatedCandidateCount,
    candidateCount,
    duplicateCandidateCount,
    totalMs: performance.now() - searchStartTime,
    baselineEvaluationMs,
    candidateEligibilityMs,
    candidateInitMs,
    candidateSolveMs,
    candidateReplayScoreMs,
    acceptedCandidateCount: acceptedCandidateLabels.length,
    roundCount,
    workerCount,
    acceptedCandidateLabels,
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

export interface TinyHyperGraphSectionPipelineMultiSectionRoundConfig {
  enabled?: boolean
  maxRounds?: number
  maxWorkers?: number
}

export interface TinyHyperGraphSectionPipelineSearchConfig {
  maxHotRegions?: number
  candidateFamilies?: TinyHyperGraphSectionCandidateFamily[]
  multiSectionRoundConfig?: TinyHyperGraphSectionPipelineMultiSectionRoundConfig
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
    let { topology, problem, solution } = loadSerializedHyperGraph(
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
      : this.inputProblem.sectionSearchConfig?.multiSectionRoundConfig?.enabled
        ? (() => {
            const searchResult = findBestMultiSectionRound(
              solvedSerializedHyperGraph,
              this.inputProblem.sectionSearchConfig,
              sectionSolverOptions,
            )

            this.selectedSectionCandidateLabel =
              searchResult.acceptedCandidateLabels[0]
            this.selectedSectionCandidateFamily = undefined
            this.stats = {
              ...this.stats,
              sectionSearchMode: "multi_section_round",
              sectionSearchGeneratedCandidateCount:
                searchResult.generatedCandidateCount,
              sectionSearchCandidateCount: searchResult.candidateCount,
              sectionSearchDuplicateCandidateCount:
                searchResult.duplicateCandidateCount,
              sectionSearchBaselineMaxRegionCost: getSerializedOutputMaxRegionCost(
                solvedSerializedHyperGraph,
              ),
              sectionSearchFinalMaxRegionCost: searchResult.finalSummary.maxRegionCost,
              sectionSearchDelta:
                getSerializedOutputMaxRegionCost(solvedSerializedHyperGraph) -
                searchResult.finalSummary.maxRegionCost,
              selectedSectionCandidateLabel:
                searchResult.acceptedCandidateLabels[0] ?? null,
              selectedSectionCandidateFamily: null,
              sectionSearchAcceptedCandidateCount:
                searchResult.acceptedCandidateCount,
              sectionSearchAcceptedCandidateLabels:
                searchResult.acceptedCandidateLabels.join(","),
              sectionSearchRounds: searchResult.roundCount,
              sectionSearchWorkers: searchResult.workerCount,
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

            ;({ topology, problem, solution } = loadSerializedHyperGraph(
              searchResult.serializedHyperGraph,
            ))
            return searchResult.portSectionMask.length === topology.portCount
              ? searchResult.portSectionMask
              : new Int8Array(topology.portCount)
          })()
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
              sectionSearchMode: "single_section",
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
