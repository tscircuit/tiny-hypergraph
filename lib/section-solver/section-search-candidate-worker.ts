import { workerData } from "node:worker_threads"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "../core"
import type { TinyHyperGraphSectionSolverOptions } from "./index"
import { TinyHyperGraphSectionSolver } from "./index"

type WorkerData = {
  candidateIndex: number
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions
  sharedBuffers: {
    notifySignal: SharedArrayBuffer
    statuses: SharedArrayBuffer
    candidateInitMs: SharedArrayBuffer
    candidateSolveMs: SharedArrayBuffer
    candidateReplayScoreMs: SharedArrayBuffer
    finalMaxRegionCosts: SharedArrayBuffer
  }
}

const getMaxRegionCost = (solver: TinyHyperGraphSectionSolver["baselineSolver"]) =>
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

const {
  candidateIndex,
  topology,
  problem,
  solution,
  sectionSolverOptions,
  sharedBuffers,
} = workerData as WorkerData

const notifySignal = new Int32Array(sharedBuffers.notifySignal)
const statuses = new Int32Array(sharedBuffers.statuses)
const candidateInitMs = new Float64Array(sharedBuffers.candidateInitMs)
const candidateSolveMs = new Float64Array(sharedBuffers.candidateSolveMs)
const candidateReplayScoreMs = new Float64Array(sharedBuffers.candidateReplayScoreMs)
const finalMaxRegionCosts = new Float64Array(sharedBuffers.finalMaxRegionCosts)

let status = -1

try {
  const candidateInitStartTime = performance.now()
  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
    sectionSolverOptions,
  )
  candidateInitMs[candidateIndex] = performance.now() - candidateInitStartTime

  const candidateSolveStartTime = performance.now()
  sectionSolver.solve()
  candidateSolveMs[candidateIndex] = performance.now() - candidateSolveStartTime

  if (sectionSolver.failed || !sectionSolver.solved) {
    status = 2
  } else {
    const candidateReplayScoreStartTime = performance.now()
    finalMaxRegionCosts[candidateIndex] = getSerializedOutputMaxRegionCost(
      sectionSolver.getOutput(),
    )
    candidateReplayScoreMs[candidateIndex] =
      performance.now() - candidateReplayScoreStartTime
    status = 1
  }
} catch {
  status = -1
}

Atomics.store(statuses, candidateIndex, status)
Atomics.add(notifySignal, 0, 1)
Atomics.notify(notifySignal, 0)
