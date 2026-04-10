import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "../core"
import type { TinyHyperGraphSectionSolverOptions } from "./index"
import { TinyHyperGraphSectionSolver, getActiveSectionRouteIds } from "./index"
import type {
  WorkerCandidateInput,
  WorkerCandidateResult,
} from "./SectionSearchWorkerPool"

const getMaxRegionCost = (
  solver: TinyHyperGraphSectionSolver["baselineSolver"],
) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  serializedHyperGraph: ReturnType<TinyHyperGraphSectionSolver["getOutput"]>,
) => {
  const replay = loadSerializedHyperGraph(serializedHyperGraph)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
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

interface WorkerRequest {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions
  candidate: WorkerCandidateInput
  scoreBuffer: SharedArrayBuffer | ArrayBuffer
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const {
    topology,
    problem,
    solution,
    sectionSolverOptions,
    candidate,
    scoreBuffer,
  } = event.data

  let result: WorkerCandidateResult = {
    index: candidate.index,
    finalMaxRegionCost: Number.POSITIVE_INFINITY,
    solved: false,
    candidateCounted: false,
    candidateEligibilityMs: 0,
    candidateInitMs: 0,
    candidateSolveMs: 0,
    candidateReplayScoreMs: 0,
  }

  try {
    const candidateProblem = createProblemWithPortSectionMask(
      problem,
      new Int8Array(candidate.portSectionMask),
    )

    const eligibilityStartTime = performance.now()
    const activeRouteIds = getActiveSectionRouteIds(
      topology,
      candidateProblem,
      solution,
    )
    result.candidateEligibilityMs = performance.now() - eligibilityStartTime

    if (activeRouteIds.length > 0) {
      result.candidateCounted = true

      const candidateInitStartTime = performance.now()
      const sectionSolver = new TinyHyperGraphSectionSolver(
        topology,
        candidateProblem,
        solution,
        sectionSolverOptions,
      )
      result.candidateInitMs = performance.now() - candidateInitStartTime

      const candidateSolveStartTime = performance.now()
      sectionSolver.solve()
      result.candidateSolveMs = performance.now() - candidateSolveStartTime

      if (sectionSolver.solved && !sectionSolver.failed) {
        const candidateReplayScoreStartTime = performance.now()
        result.finalMaxRegionCost = getSerializedOutputMaxRegionCost(
          sectionSolver.getOutput(),
        )
        result.candidateReplayScoreMs =
          performance.now() - candidateReplayScoreStartTime
        result.solved = true
      }
    }
  } catch {
    // Skip invalid section masks that split a route into multiple spans.
  }

  new Float64Array(scoreBuffer)[candidate.index] = result.finalMaxRegionCost
  self.postMessage(result)
}
