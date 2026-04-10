import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "../core"
import type { RegionId } from "../types"
import type { TinyHyperGraphSectionSolverOptions } from "./index"

export interface WorkerCandidateInput {
  index: number
  label: string
  family: string
  regionIds: RegionId[]
  portSectionMask: Int8Array
}

export interface WorkerCandidateResult {
  index: number
  finalMaxRegionCost: number
  solved: boolean
  candidateCounted: boolean
  candidateEligibilityMs: number
  candidateInitMs: number
  candidateSolveMs: number
  candidateReplayScoreMs: number
}

interface WorkerRequest {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
  sectionSolverOptions: TinyHyperGraphSectionSolverOptions
  candidate: WorkerCandidateInput
  scoreBuffer: SharedArrayBuffer | ArrayBuffer
}

const getWorkerUrl = () =>
  new URL("./section-search.worker.ts", import.meta.url)

export class SectionSearchWorkerPool {
  private readonly workerCount: number

  constructor(workerCount: number) {
    this.workerCount = Math.max(1, workerCount)
  }

  async runCandidates(
    args: Omit<WorkerRequest, "candidate">,
    candidates: WorkerCandidateInput[],
  ): Promise<WorkerCandidateResult[]> {
    if (typeof Worker === "undefined" || candidates.length === 0) {
      return []
    }

    const pending = [...candidates]
    const results: WorkerCandidateResult[] = []

    await Promise.all(
      Array.from({ length: Math.min(this.workerCount, candidates.length) }).map(
        () =>
          new Promise<void>((resolve) => {
            const worker = new Worker(getWorkerUrl(), { type: "module" })
            const runNext = () => {
              const candidate = pending.shift()
              if (!candidate) {
                worker.terminate()
                resolve()
                return
              }

              const request: WorkerRequest = {
                ...args,
                candidate,
              }
              worker.postMessage(request)
            }

            worker.onmessage = (event: MessageEvent<WorkerCandidateResult>) => {
              results.push(event.data)
              runNext()
            }

            worker.onerror = () => {
              worker.terminate()
              resolve()
            }

            runNext()
          }),
      ),
    )

    return results.sort((left, right) => left.index - right.index)
  }
}
