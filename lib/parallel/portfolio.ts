import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver, type TinyHyperGraphSolverOptions } from "../core"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import {
  runPortfolioCandidate,
  comparePortfolioCandidates,
  type PortfolioCandidate,
  type PortfolioBackend,
} from "./portfolio-candidate"
import {
  defaultWorkerCount,
  validateWorkerCount,
  WorkerPool,
} from "./WorkerPool"
import type { SolveResult, PortfolioRoutingState } from "./protocol"
import {
  createSharedRouteDistances,
  createSharedRouteHeuristics,
} from "./shared-distances"
import { packPortfolioInput } from "./packed-input"

export interface PortfolioSolveResult extends SolveResult {
  selectedCandidate: number
  candidates: PortfolioCandidate[]
  quality: PortfolioCandidate["quality"]
}

/** Eight fixed candidates for ONE graph; wait for all before selecting. The
 * worker count controls scheduling only, never the algorithm or budget. */
async function solvePortfolio(
  graph: SerializedHyperGraph,
  options: {
    workers?: number
    solverOptions?: TinyHyperGraphSolverOptions
    backend?: PortfolioBackend
    baselineIterations?: number
  } = {},
  suppliedPool?: WorkerPool,
): Promise<PortfolioSolveResult> {
  const workers = Math.min(
    8,
    validateWorkerCount(options.workers ?? defaultWorkerCount()),
  )
  const solverOptions = {
    ...options.solverOptions,
    MAX_ITERATIONS: options.solverOptions?.MAX_ITERATIONS ?? 250_000,
  }
  const baselineIterations =
    options.baselineIterations ??
    options.solverOptions?.MAX_ITERATIONS ??
    250_000
  if (!Number.isSafeInteger(baselineIterations) || baselineIterations < 1)
    throw new Error("baselineIterations must be a positive integer")
  if (
    !Number.isSafeInteger(solverOptions.MAX_ITERATIONS) ||
    solverOptions.MAX_ITERATIONS < 1
  )
    throw new Error("MAX_ITERATIONS must be a positive integer")
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const backend = options.backend ?? "wasm"
  if (backend !== "wasm" && backend !== "javascript")
    throw new Error("Unsupported portfolio backend")
  const distances =
    backend === "javascript" ? createSharedRouteDistances(topology) : undefined
  const heuristics =
    backend === "javascript"
      ? createSharedRouteHeuristics(topology, problem)
      : undefined
  const candidates: PortfolioCandidate[] = new Array(8)
  if (workers === 1) {
    let best: ReturnType<typeof runPortfolioCandidate> | undefined
    for (let index = 0; index < 8; index++) {
      const result = runPortfolioCandidate(
        topology,
        problem,
        solverOptions,
        index,
        distances,
        heuristics,
        backend,
        baselineIterations,
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
  const pool = suppliedPool ?? new WorkerPool(workers)
  const input = packPortfolioInput(topology, problem)
  const owners = new Array<number>(8)
  let nextIndex = 0
  try {
    await Promise.all(
      pool.slots.map((slot) =>
        slot.run({
          kind: "portfolioInit",
          input,
          options: solverOptions,
          distances,
          heuristics,
          backend,
          baselineIterations,
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
    if (!suppliedPool) await pool.close()
  }
}

/** Convenience call including worker creation and termination. */
export async function solveTinyHyperGraphPortfolio(
  graph: SerializedHyperGraph,
  options: {
    workers?: number
    solverOptions?: TinyHyperGraphSolverOptions
    backend?: PortfolioBackend
    baselineIterations?: number
  } = {},
): Promise<PortfolioSolveResult> {
  return solvePortfolio(graph, options)
}

/** Reuse worker runtimes across sequential graphs, preserving the exact same
 * per-graph algorithm. Each graph still runs eight fixed candidates. */
export class TinyHyperGraphPortfolioPool {
  readonly workers: number
  readonly backend: PortfolioBackend
  readonly baselineIterations?: number
  private pool?: WorkerPool
  private running = false
  private closed = false
  constructor(
    options: {
      workers?: number
      backend?: PortfolioBackend
      baselineIterations?: number
    } = {},
  ) {
    this.baselineIterations = options.baselineIterations
    if (
      this.baselineIterations !== undefined &&
      (!Number.isSafeInteger(this.baselineIterations) ||
        this.baselineIterations < 1)
    )
      throw new Error("baselineIterations must be a positive integer")
    this.backend = options.backend ?? "wasm"
    if (this.backend !== "wasm" && this.backend !== "javascript")
      throw new Error("Unsupported portfolio backend")
    this.workers = Math.min(
      8,
      validateWorkerCount(options.workers ?? defaultWorkerCount()),
    )
    if (this.workers > 1) this.pool = new WorkerPool(this.workers)
  }
  async solve(
    graph: SerializedHyperGraph,
    solverOptions: TinyHyperGraphSolverOptions = {},
  ): Promise<PortfolioSolveResult> {
    if (this.closed) throw new Error("Portfolio pool is closed")
    if (this.running) throw new Error("Portfolio pool is already running")
    this.running = true
    try {
      return await solvePortfolio(
        graph,
        {
          workers: this.workers,
          solverOptions,
          backend: this.backend,
          baselineIterations: this.baselineIterations,
        },
        this.pool,
      )
    } catch (error) {
      this.closed = true
      await this.pool?.close()
      throw error
    } finally {
      this.running = false
    }
  }
  async close() {
    if (this.running)
      throw new Error("Cannot close a portfolio pool while it is running")
    if (this.closed) return
    this.closed = true
    await this.pool?.close()
    this.pool = undefined
  }
}
