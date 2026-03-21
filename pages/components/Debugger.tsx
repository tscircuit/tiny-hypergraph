import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

export const Debugger = ({
  serializedHyperGraph,
}: {
  serializedHyperGraph?: SerializedHyperGraph
}) => (
  <GenericSolverDebugger
    createSolver={() => {
      if (serializedHyperGraph) {
        const { topology, problem } =
          loadSerializedHyperGraph(serializedHyperGraph)
        return new TinyHyperGraphSolver(topology, problem)
      }
      throw new Error("Couldn't load solver")
    }}
  />
)
