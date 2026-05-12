import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { portChokepointFixture } from "../tests/fixtures/port-chokepoint.fixture"
import { Debugger } from "./components/Debugger"

const createSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
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
        routes from the bottom left endpoint to the bottom right endpoint. Both
        nets must pass through the single <code>left-center-choke</code> and{" "}
        <code>center-right-choke</code> ports, so after one route claims the
        corridor the other route has no valid port-disjoint path.
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
