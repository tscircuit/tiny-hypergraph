import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver, type TinyHyperGraphSolverOptions } from "../core"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import {
  runPortfolioCandidate,
  comparePortfolioCandidates,
  type PortfolioCandidate,
} from "./portfolio-candidate"
import {
  defaultWorkerCount,
  validateWorkerCount,
  WorkerPool,
} from "./WorkerPool"
import type { SolveResult, PortfolioRoutingState } from "./protocol"

export interface PortfolioSolveResult extends SolveResult {
  selectedCandidate: number
  candidates: PortfolioCandidate[]
  quality: PortfolioCandidate["quality"]
}

/** Eight fixed candidates for ONE graph; wait for all before selecting. The
 * worker count controls scheduling only, never the algorithm or budget. */
export async function solveTinyHyperGraphPortfolio(
  graph: SerializedHyperGraph,
  options: {
    workers?: number
    solverOptions?: TinyHyperGraphSolverOptions
  } = {},
): Promise<PortfolioSolveResult> {
  const workers = Math.min(
    8,
    validateWorkerCount(options.workers ?? defaultWorkerCount()),
  )
  const solverOptions = {
    ...options.solverOptions,
    MAX_ITERATIONS: options.solverOptions?.MAX_ITERATIONS ?? 250_000,
  }
  if (
    !Number.isSafeInteger(solverOptions.MAX_ITERATIONS) ||
    solverOptions.MAX_ITERATIONS < 1
  )
    throw new Error("MAX_ITERATIONS must be a positive integer")
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const candidates: PortfolioCandidate[] = new Array(8)
  if (workers === 1) {
    let best: ReturnType<typeof runPortfolioCandidate> | undefined
    for (let index = 0; index < 8; index++) {
      const result = runPortfolioCandidate(
        topology,
        problem,
        solverOptions,
        index,
      )
      candidates[index] = result.candidate
      if (
        !best ||
        comparePortfolioCandidates(result.candidate, best.candidate) < 0
      )
        best = result
    }
    return {
      ...best!.candidate,
      selectedCandidate: best!.candidate.index,
      candidates,
      output:
        best!.solver.solved && !best!.solver.failed
          ? best!.solver.getOutput()
          : null,
    }
  }
  const pool = new WorkerPool(workers)
  const owners = new Array<number>(8)
  let nextIndex = 0
  try {
    await Promise.all(
      pool.slots.map((slot) =>
        slot.run({
          kind: "portfolioInit",
          topology,
          problem,
          options: solverOptions,
        }),
      ),
    )
    await Promise.all(
      pool.slots.map(async (slot, owner) => {
        while (nextIndex < 8) {
          const index = nextIndex++
          owners[index] = owner
          candidates[index] = await slot.run<PortfolioCandidate>({
            kind: "portfolioCandidate",
            index,
          })
        }
      }),
    )
    const best = [...candidates].sort(comparePortfolioCandidates)[0]
    const state = await pool.slots[
      owners[best.index]
    ].run<PortfolioRoutingState | null>({
      kind: "portfolioOutput",
      index: best.index,
    })
    let output: SolveResult["output"] = null
    if (state) {
      // Original serialized IDs are nonenumerable metadata and do not survive
      // structured cloning. Convert the winner against the caller's metadata.
      const renderer = new TinyHyperGraphSolver(topology, {
        ...problem,
        initialAssignments: undefined,
      })
      renderer.solved = true
      renderer.state.portAssignment = state.portAssignment
      renderer.state.regionSegments = state.regionSegments
      output = renderer.getOutput()
    }
    return { ...best, selectedCandidate: best.index, candidates, output }
  } finally {
    await pool.close()
  }
}
