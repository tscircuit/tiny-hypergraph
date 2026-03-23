import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { BaseSolver } from "@tscircuit/solver-utils"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

export interface DebuggerProps {
  serializedHyperGraph?: SerializedHyperGraph
  createSolver?: (input: ReturnType<typeof loadSerializedHyperGraph>) => BaseSolver
}

export const Debugger = ({
  serializedHyperGraph,
  createSolver,
}: DebuggerProps) => (
  <GenericSolverDebugger
    createSolver={() => {
      if (serializedHyperGraph) {
        const input = loadSerializedHyperGraph(serializedHyperGraph)
        return (
          createSolver?.(input) ??
          new TinyHyperGraphSolver(input.topology, input.problem)
        )
      }
      throw new Error("Couldn't load solver")
    }}
  />
)
