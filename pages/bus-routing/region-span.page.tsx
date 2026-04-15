import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusSolver, TinyHyperGraphSolver } from "lib/index"
import {
  BUS_REGION_SPAN_ROUTE_COUNT,
  BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE,
  busRegionSpanFixture,
} from "../../tests/fixtures/bus-region-span.fixture"
import { Debugger } from "../components/Debugger"

const createBusSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  return new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 50_000,
    CENTER_GREEDY_HEURISTIC_MULTIPLIER: 1_000,
    VISUALIZE_UNASSIGNED_PORTS: true,
  })
}

const createPlainSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  return new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 50_000,
  })
}

export default function BusRoutingRegionSpanPage() {
  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        This synthetic repro builds a{" "}
        <code>{BUS_REGION_SPAN_ROUTE_COUNT}-trace</code> bus with four main
        routing regions: a large <code>top-main</code>, a large{" "}
        <code>bottom-main</code>, and a slit middle split into{" "}
        <code>mid-left</code> and <code>mid-right</code>. Each middle half only
        exposes <code>{BUS_REGION_SPAN_SHARED_PORTS_PER_MIDDLE_EDGE}</code>{" "}
        shared ports on its top and bottom edges, so no single half can carry
        the full bus. Two extra bottom-side regions keep the middle halves more
        than two hops from the goal transit region, so the bus solver cannot
        escape through the manual two-hop finish rule.
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">
            Current Bus Solver
          </div>
          <div className="min-h-0 flex-1">
            <Debugger
              serializedHyperGraph={busRegionSpanFixture}
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
              serializedHyperGraph={busRegionSpanFixture}
              createSolver={createPlainSolver}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
