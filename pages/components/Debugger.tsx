import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { BaseSolver } from "@tscircuit/solver-utils"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

export const Debugger = ({
  serializedHyperGraph,
  createSolver,
}: {
  serializedHyperGraph?: SerializedHyperGraph
  createSolver?: (serializedHyperGraph: SerializedHyperGraph) => BaseSolver
}) => (
  <GenericSolverDebugger
    createSolver={() => {
      if (serializedHyperGraph) {
        if (createSolver) {
          return createSolver(serializedHyperGraph)
        }
        const { topology, problem } =
          loadSerializedHyperGraph(serializedHyperGraph)
        return new TinyHyperGraphSolver(topology, problem)
      }
      throw new Error("Couldn't load solver")
    }}
  />
)
