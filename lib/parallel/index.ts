import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphSolverOptions } from "../core"
import type { SolveResult } from "./protocol"
import {
  defaultWorkerCount,
  validateWorkerCount,
  WorkerPool,
} from "./WorkerPool"

export {
  ParallelTinyHyperGraphSolver,
  type ParallelTinyHyperGraphSolverOptions,
} from "./ParallelTinyHyperGraphSolver"
export type { SolveResult } from "./protocol"

/** Independent graphs run on separate cores; results retain input order. */
export async function solveTinyHyperGraphsParallel(
  graphs: readonly SerializedHyperGraph[],
  options: {
    workers?: number
    solverOptions?: TinyHyperGraphSolverOptions
  } = {},
): Promise<SolveResult[]> {
  const count = validateWorkerCount(options.workers ?? defaultWorkerCount())
  if (!graphs.length) return []
  const pool = new WorkerPool(Math.min(count, graphs.length))
  const results = new Array<SolveResult>(graphs.length)
  let nextIndex = 0
  try {
    await Promise.all(
      pool.slots.map(async (slot) => {
        while (nextIndex < graphs.length) {
          const index = nextIndex++
          results[index] = await slot.run<SolveResult>({
            kind: "solve",
            graph: graphs[index],
            options: options.solverOptions,
          })
        }
      }),
    )
    return results
  } finally {
    await pool.close()
  }
}
