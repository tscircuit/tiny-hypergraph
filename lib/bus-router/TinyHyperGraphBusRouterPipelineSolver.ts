import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type { TinyHyperGraphSolverOptions } from "../core"
import { TinyHyperGraphSolver } from "../core"
import { visualizeTinyGraph } from "../visualizeTinyGraph"
import {
  createBusSerializedHyperGraph,
  extractBusTracePaths,
  type TinyHyperGraphBusBaselineStageOutput,
  type TinyHyperGraphBusData,
  type TinyHyperGraphBusRouterPipelineOutput,
} from "./common"
import { TinyHyperGraphBusBaselineRoutingSolver } from "./TinyHyperGraphBusBaselineRoutingSolver"
import { TinyHyperGraphBusCenterlineSolver } from "./TinyHyperGraphBusCenterlineSolver"

export interface TinyHyperGraphBusRouterPipelineInput {
  serializedHyperGraph: SerializedHyperGraph
  bus: TinyHyperGraphBusData
  baselineSolverOptions?: TinyHyperGraphSolverOptions
  centerlineSegmentCount?: number
}

export class TinyHyperGraphBusRouterPipelineSolver extends BasePipelineSolver<TinyHyperGraphBusRouterPipelineInput> {
  busSerializedHyperGraph?: SerializedHyperGraph
  initialVisualizationSolver?: TinyHyperGraphSolver

  override pipelineDef = [
    {
      solverName: "baselineNoIntersectionCostPaths",
      solverClass: TinyHyperGraphBusBaselineRoutingSolver,
      getConstructorParams: (
        instance: TinyHyperGraphBusRouterPipelineSolver,
      ) => {
        const { topology, problem } = loadSerializedHyperGraph(
          instance.getBusSerializedHyperGraph(),
        )

        return [
          topology,
          problem,
          instance.inputProblem.bus.busId,
          instance.inputProblem.baselineSolverOptions,
        ] as ConstructorParameters<
          typeof TinyHyperGraphBusBaselineRoutingSolver
        >
      },
    },
    {
      solverName: "centerlinePath",
      solverClass: TinyHyperGraphBusCenterlineSolver,
      getConstructorParams: (
        instance: TinyHyperGraphBusRouterPipelineSolver,
      ) => {
        const baselineStageOutput =
          instance.getStageOutput<SerializedHyperGraph>(
            "baselineNoIntersectionCostPaths",
          )

        if (!baselineStageOutput) {
          throw new Error(
            "Bus baseline stage did not produce baselineNoIntersectionCostPaths",
          )
        }

        return [
          instance.createBaselineStageOutput(baselineStageOutput),
          instance.inputProblem.centerlineSegmentCount ?? 20,
        ] as ConstructorParameters<typeof TinyHyperGraphBusCenterlineSolver>
      },
    },
  ]

  getBusSerializedHyperGraph() {
    if (!this.busSerializedHyperGraph) {
      this.busSerializedHyperGraph = createBusSerializedHyperGraph(
        this.inputProblem.serializedHyperGraph,
        this.inputProblem.bus,
      )
    }

    return this.busSerializedHyperGraph
  }

  getInitialVisualizationSolver() {
    if (!this.initialVisualizationSolver) {
      const { topology, problem } = loadSerializedHyperGraph(
        this.getBusSerializedHyperGraph(),
      )

      this.initialVisualizationSolver = new TinyHyperGraphSolver(
        topology,
        problem,
      )
    }

    return this.initialVisualizationSolver
  }

  createBaselineStageOutput(
    baselineSerializedHyperGraph: SerializedHyperGraph,
  ): TinyHyperGraphBusBaselineStageOutput {
    return {
      busId: this.inputProblem.bus.busId,
      serializedHyperGraph: baselineSerializedHyperGraph,
      baselineNoIntersectionCostPaths: extractBusTracePaths(
        baselineSerializedHyperGraph,
      ),
    }
  }

  override initialVisualize() {
    const graphics = visualizeTinyGraph(this.getInitialVisualizationSolver())

    graphics.title = [
      "Bus Router Input",
      `bus=${this.inputProblem.bus.busId}`,
      `routes=${this.inputProblem.bus.connectionPatches.length}`,
    ].join(" | ")

    return graphics
  }

  override visualize(): GraphicsObject {
    if (this.iterations === 0) {
      return this.initialVisualize() ?? super.visualize()
    }

    return super.visualize()
  }

  override getOutput():
    | TinyHyperGraphBusRouterPipelineOutput
    | TinyHyperGraphBusBaselineStageOutput
    | null {
    const centerlineOutput =
      this.getStageOutput<TinyHyperGraphBusRouterPipelineOutput>(
        "centerlinePath",
      ) ?? null

    if (centerlineOutput) {
      return centerlineOutput
    }

    const baselineSerializedHyperGraph =
      this.getStageOutput<SerializedHyperGraph>(
        "baselineNoIntersectionCostPaths",
      ) ?? null

    return (
      (baselineSerializedHyperGraph
        ? this.createBaselineStageOutput(baselineSerializedHyperGraph)
        : null) ?? null
    )
  }
}
