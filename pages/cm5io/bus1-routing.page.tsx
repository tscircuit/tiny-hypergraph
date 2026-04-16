import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { useEffect, useState } from "react"
import { Debugger } from "../components/Debugger"

const cm5ioHyperGraphFixtureUrl = new URL(
  "../../tests/fixtures/CM5IO_HyperGraph.json",
  import.meta.url,
).href

const cm5ioBusSelectionFixtureUrl = new URL(
  "../../tests/fixtures/CM5IO_bus1.json",
  import.meta.url,
).href

const CM5IO_CENTER_PORT_OPTIONS_PER_EDGE = 16

const createBusSubsetSerializedHyperGraph = (
  fullInput: SerializedHyperGraphPortPointPathingSolverInput,
  busSelection: ConnectionPatchSelection,
): SerializedHyperGraph =>
  convertPortPointPathingSolverInputToSerializedHyperGraph(
    filterPortPointPathingSolverInputByConnectionPatches(
      fullInput,
      busSelection,
    ),
  )

export default function Cm5ioBus1RoutingPage() {
  const [serializedHyperGraph, setSerializedHyperGraph] =
    useState<SerializedHyperGraph>()
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let isCancelled = false

    const loadFixture = async () => {
      try {
        const [fullResponse, busSelectionResponse] = await Promise.all([
          fetch(cm5ioHyperGraphFixtureUrl),
          fetch(cm5ioBusSelectionFixtureUrl),
        ])

        if (!fullResponse.ok) {
          throw new Error(
            `Failed to load CM5IO hypergraph fixture (${fullResponse.status})`,
          )
        }

        if (!busSelectionResponse.ok) {
          throw new Error(
            `Failed to load CM5IO bus selection fixture (${busSelectionResponse.status})`,
          )
        }

        const fullInput =
          (await fullResponse.json()) as SerializedHyperGraphPortPointPathingSolverInput
        const busSelection =
          (await busSelectionResponse.json()) as ConnectionPatchSelection
        const subsetSerializedHyperGraph = createBusSubsetSerializedHyperGraph(
          fullInput,
          busSelection,
        )

        if (!isCancelled) {
          setSerializedHyperGraph(subsetSerializedHyperGraph)
          setErrorMessage(undefined)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load CM5IO bus subset fixture",
          )
        }
      }
    }

    void loadFixture()

    return () => {
      isCancelled = true
    }
  }, [])

  if (errorMessage) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded border border-red-300 bg-white p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      </div>
    )
  }

  if (!serializedHyperGraph) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-600">
        Loading CM5IO bus subset fixture...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        CM5IO <code>bus1</code> routed by the centerline-only bus solver. One
        centerline candidate is expanded per step, the rest of the bus is
        inferred from nearby z=0 boundary ports, and regions marked with
        <code>bus end-manual hop</code> switch the centerline over to the manual
        two-hop finish logic near the destination.
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          serializedHyperGraph={serializedHyperGraph}
          createSolver={(graph) => {
            const { topology, problem } = loadSerializedHyperGraph(graph)
            return new TinyHyperGraphBusSolver(topology, problem, {
              MAX_ITERATIONS: 250_000,
              CENTER_PORT_OPTIONS_PER_EDGE: CM5IO_CENTER_PORT_OPTIONS_PER_EDGE,
            })
          }}
        />
      </div>
    </div>
  )
}
