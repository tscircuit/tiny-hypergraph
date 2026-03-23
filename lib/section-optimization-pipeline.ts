import {
  BasePipelineSolver,
  BaseSolver,
  type PipelineStep,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "./index"
import {
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSectionSolverOutput,
} from "./section-solver"

interface TinyHyperGraphPipelineSolveStageInput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solverOptions?: TinyHyperGraphSolverOptions
}

class TinyHyperGraphPipelineSolveStage extends BaseSolver {
  solver: TinyHyperGraphSolver

  constructor(public input: TinyHyperGraphPipelineSolveStageInput) {
    super()
    this.solver = new TinyHyperGraphSolver(
      input.topology,
      input.problem,
      input.solverOptions ?? {},
    )
    this.MAX_ITERATIONS = this.solver.MAX_ITERATIONS
  }

  getSolution() {
    return this.solver.getSolution()
  }

  override _step() {
    this.solver.step()
    this.stats = this.solver.stats
    this.progress = this.solver.progress

    if (this.solver.failed) {
      this.failed = true
      this.error = this.solver.error
      return
    }

    if (this.solver.solved) {
      this.solved = true
    }
  }

  override getConstructorParams() {
    return [this.input]
  }

  override getOutput() {
    return null
  }

  override visualize() {
    return this.solver.visualize()
  }
}

export interface TinyHyperGraphSectionOptimizationPipelineInput {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solverOptions?: TinyHyperGraphSolverOptions
  sectionSolverOptions?: TinyHyperGraphSectionSolverOptions
}

export class TinyHyperGraphSectionOptimizationPipelineSolver extends BasePipelineSolver<TinyHyperGraphSectionOptimizationPipelineInput> {
  initialSolver?: TinyHyperGraphPipelineSolveStage
  sectionSolver?: TinyHyperGraphSectionSolver

  pipelineDef: PipelineStep<any>[] = [
    definePipelineStep(
      "initialSolver",
      TinyHyperGraphPipelineSolveStage,
      (instance: TinyHyperGraphSectionOptimizationPipelineSolver) => [
        {
          topology: instance.inputProblem.topology,
          problem: instance.inputProblem.problem,
          solverOptions: instance.inputProblem.solverOptions,
        },
      ],
    ),
    definePipelineStep(
      "sectionSolver",
      TinyHyperGraphSectionSolver,
      (instance: TinyHyperGraphSectionOptimizationPipelineSolver) => [
        {
          topology: instance.inputProblem.topology,
          problem: instance.inputProblem.problem,
          solution: instance
            .getSolver<TinyHyperGraphPipelineSolveStage>("initialSolver")!
            .getSolution(),
          regionCosts: Float64Array.from(
            instance
              .getSolver<TinyHyperGraphPipelineSolveStage>("initialSolver")!
              .solver.state.regionIntersectionCaches.map(
                (regionCache) => regionCache.existingRegionCost,
              ),
          ),
          options: instance.inputProblem.sectionSolverOptions,
        },
      ],
    ),
  ]

  override getConstructorParams() {
    return [this.inputProblem]
  }

  getInitialSolveSolver(): TinyHyperGraphSolver | undefined {
    return this.getSolver<TinyHyperGraphPipelineSolveStage>("initialSolver")
      ?.solver
  }

  getSectionOptimizationSolver(): TinyHyperGraphSectionSolver | undefined {
    return this.getSolver<TinyHyperGraphSectionSolver>("sectionSolver")
  }

  override getOutput(): TinyHyperGraphSectionSolverOutput | null {
    if (!this.solved || this.failed) {
      return null
    }

    return (
      this.getSolver<TinyHyperGraphSectionSolver>(
        "sectionSolver",
      )?.getOutput() ?? null
    )
  }
}
