import { parentPort } from "node:worker_threads"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { writeFileSync } from "node:fs"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "../core"
import type { RegionId } from "../types"
import type { RegionIntersectionCache } from "../types"
import {
  getActiveSectionRouteIds,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionSolverOptions,
} from "./index"
import type {
  TinyHyperGraphSectionCandidateFamily,
} from "./TinyHyperGraphSectionPipelineSolver"

type SectionMaskCandidate = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: RegionId[]
  portSelectionRule: "touches-selected-region" | "all-incident-regions-selected"
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

type ImprovementEntry = {
  label: string
  family: TinyHyperGraphSectionCandidateFamily
  regionIds: RegionId[]
  improvement: number
  portSectionMask: Int8Array
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

const IMPROVEMENT_EPSILON = 1e-9

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
  routeStartPort: problem.routeStartPort,
  routeEndPort: problem.routeEndPort,
  routeNet: problem.routeNet,
  regionNetId: problem.regionNetId,
})

const getSerializedOutputMaxRegionCost = (
  serializedOutput: SerializedHyperGraph,
) => {
  const replay = loadSerializedHyperGraph(serializedOutput)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return replayedSolver.baselineSolver.state.regionIntersectionCaches.reduce(
    (
      maxRegionCost: number,
      regionIntersectionCache: RegionIntersectionCache,
    ) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )
}

parentPort?.on("message", (input: ParallelSectionSearchWorkerInput) => {
  let bestFinalMaxRegionCost = input.baselineMaxRegionCost
  let bestPortSectionMask = new Int8Array(input.topology.portCount)
  let winningCandidateLabel: string | undefined
  let winningCandidateFamily: TinyHyperGraphSectionCandidateFamily | undefined
  let candidateCount = 0
  let candidateEligibilityMs = 0
  let candidateInitMs = 0
  let candidateSolveMs = 0
  let candidateReplayScoreMs = 0
  const improvementEntries: ImprovementEntry[] = []

  for (const candidate of input.candidates) {
    const candidateProblem = createProblemWithPortSectionMask(
      input.problem,
      createPortSectionMaskForRegionIds(
        input.topology,
        candidate.regionIds,
        candidate.portSelectionRule,
      ),
    )

    try {
      const eligibilityStartTime = performance.now()
      const activeRouteIds = getActiveSectionRouteIds(
        input.topology,
        candidateProblem,
        input.solution,
      )
      candidateEligibilityMs += performance.now() - eligibilityStartTime

      if (activeRouteIds.length === 0) {
        continue
      }

      candidateCount += 1

      const candidateInitStartTime = performance.now()
      const sectionSolver = new TinyHyperGraphSectionSolver(
        input.topology,
        candidateProblem,
        input.solution,
        input.sectionSolverOptions,
      )
      candidateInitMs += performance.now() - candidateInitStartTime

      const candidateSolveStartTime = performance.now()
      sectionSolver.solve()
      candidateSolveMs += performance.now() - candidateSolveStartTime

      if (sectionSolver.failed || !sectionSolver.solved) {
        continue
      }

      const candidateReplayScoreStartTime = performance.now()
      const replayedFinalMaxRegionCost = getSerializedOutputMaxRegionCost(
        sectionSolver.getOutput(),
      )
      candidateReplayScoreMs += performance.now() - candidateReplayScoreStartTime

      const improvement = input.baselineMaxRegionCost - replayedFinalMaxRegionCost

      if (improvement > IMPROVEMENT_EPSILON) {
        improvementEntries.push({
          label: candidate.label,
          family: candidate.family,
          regionIds: candidate.regionIds,
          improvement,
          portSectionMask: new Int8Array(candidateProblem.portSectionMask),
        })
      }

      if (replayedFinalMaxRegionCost < bestFinalMaxRegionCost - IMPROVEMENT_EPSILON) {
        bestFinalMaxRegionCost = replayedFinalMaxRegionCost
        bestPortSectionMask = new Int8Array(candidateProblem.portSectionMask)
        winningCandidateLabel = candidate.label
        winningCandidateFamily = candidate.family
      }
    } catch {
      // Skip invalid section masks that split a route into multiple spans.
    }
  }

  const result: ParallelSectionSearchWorkerResult = {
    bestFinalMaxRegionCost,
    bestPortSectionMask,
    winningCandidateLabel,
    winningCandidateFamily,
    generatedCandidateCount: input.candidates.length,
    candidateCount,
    duplicateCandidateCount: 0,
    candidateEligibilityMs,
    candidateInitMs,
    candidateSolveMs,
    candidateReplayScoreMs,
    improvementEntries,
  }

  if (input.resultPath) {
    writeFileSync(
      input.resultPath,
      JSON.stringify({
        ...result,
        bestPortSectionMask: Array.from(result.bestPortSectionMask),
        improvementEntries: result.improvementEntries.map((entry) => ({
          ...entry,
          portSectionMask: Array.from(entry.portSectionMask),
        })),
      }),
    )
  }

  if (input.doneSignal) {
    Atomics.store(input.doneSignal, 0, 1)
    Atomics.notify(input.doneSignal, 0)
  } else {
    parentPort?.postMessage(result)
  }
})
