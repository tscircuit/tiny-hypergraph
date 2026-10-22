import { SolverRuntime } from "@tscircuit/solver-utils"
import { TinyHyperGraphSolver } from "./core"
import {
  createSingleRouteProblem,
  getUsedPortIdsForSolvedRoute,
} from "./DuplicateCongestedPortSolver"
import {
  unpackRouteSearchTopology,
  type SharedRouteSearchGraph,
} from "./parallelRouteSearchData"

interface IndependentRoutesInput {
  graph: SharedRouteSearchGraph
  routeIds: number[]
}

export interface IndependentRoutesOutput {
  portIds: number[][]
  error?: string
}

const workspaces = new Map<number, TinyHyperGraphSolver>()

/** Independent empty-board route estimates used to identify congested ports. */
export class TinyHyperGraphIndependentRoutesSolver {
  static readonly solverName = "TinyHyperGraphIndependentRoutesSolver"
  private output?: IndependentRoutesOutput

  constructor(private readonly input: IndependentRoutesInput) {}

  solve(): void {
    const { graph, routeIds } = this.input
    let solver = workspaces.get(graph.id)
    const output: number[][] = []
    for (const routeId of routeIds) {
      const problem = createSingleRouteProblem(graph.problem, routeId)
      if (solver) solver.resetForProblem(problem)
      else {
        solver = new TinyHyperGraphSolver(
          unpackRouteSearchTopology(graph.topology),
          problem,
          graph.options,
        )
        if (workspaces.size >= 4)
          workspaces.delete(workspaces.keys().next().value!)
        workspaces.set(graph.id, solver)
      }
      solver.solve()
      if (!solver.solved || solver.failed) {
        this.output = {
          portIds: output,
          error: `Route ${routeId} could not be solved independently: ${solver.error ?? "unknown error"}`,
        }
        return
      }
      output.push([...getUsedPortIdsForSolvedRoute(solver)])
    }
    this.output = { portIds: output }
  }

  getOutput(): IndependentRoutesOutput {
    if (!this.output) throw new Error("Independent routes have not been solved")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHyperGraphIndependentRoutesSolver)
