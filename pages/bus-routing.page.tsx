import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphBusRoutingSolver } from "lib/index"
import { busRoutingFixture } from "../tests/fixtures/bus-routing.fixture"
import { Debugger } from "./components/Debugger"

export default function BusRoutingPage() {
  return (
    <Debugger
      serializedHyperGraph={busRoutingFixture}
      createSolver={(serializedHyperGraph) => {
        const { topology, problem } =
          loadSerializedHyperGraph(serializedHyperGraph)

        return new TinyHyperGraphBusRoutingSolver(topology, problem)
      }}
    />
  )
}
