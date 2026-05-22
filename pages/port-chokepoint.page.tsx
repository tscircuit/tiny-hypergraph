import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { DuplicateCongestedPortSolver, TinyHyperGraphSolver } from "lib/index"
import { portChokepointFixture } from "../tests/fixtures/port-chokepoint.fixture"
import { Debugger } from "./components/Debugger"

const createSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const duplicateCongestedPortSolver = new DuplicateCongestedPortSolver(
    serializedHyperGraph,
  )
  duplicateCongestedPortSolver.solve()
  const { topology, problem } = loadSerializedHyperGraph(
    duplicateCongestedPortSolver.getOutput(),
  )

  return new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 20_000,
    STATIC_REACHABILITY_PRECHECK: false,
  })
}

export default function PortChokepointPage() {
  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        Port chokepoint repro: <code>connection-a</code> routes from the top
        left endpoint to the top right endpoint, while <code>connection-b</code>{" "}
        routes from the bottom left endpoint to the bottom right endpoint. The
        page first runs <code>DuplicateCongestedPortSolver</code>, then routes
        the repaired topology with the strict core solver.
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-slate-300 bg-white">
        <Debugger
          serializedHyperGraph={portChokepointFixture}
          createSolver={createSolver}
        />
      </div>
    </div>
  )
}
