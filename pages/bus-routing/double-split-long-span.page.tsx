import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver, TinyHyperGraphSolver } from "lib/index"
import {
  busDoubleSplitLongSpanFixture,
} from "../../tests/fixtures/bus-double-split-long-span.fixture"
import { Debugger } from "../components/Debugger"

const createBusSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  return new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
}

const createPlainSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  return new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100_000,
  })
}

export default function BusRoutingDoubleSplitLongSpanPage() {
  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">
            Current Bus Solver
          </div>
          <div className="min-h-0 flex-1">
            <Debugger
              serializedHyperGraph={busDoubleSplitLongSpanFixture}
              createSolver={createBusSolver}
            />
          </div>
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">
            Reference Plain Solver
          </div>
          <div className="min-h-0 flex-1">
            <Debugger
              serializedHyperGraph={busDoubleSplitLongSpanFixture}
              createSolver={createPlainSolver}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
