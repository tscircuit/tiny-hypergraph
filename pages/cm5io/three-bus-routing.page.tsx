import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  filterPortPointPathingSolverInputByConnectionPatches,
  TinyHyperGraphSequentialBusSolver,
  type ConnectionPatchSelection,
} from "lib/index"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { useEffect, useState } from "react"
import { Debugger } from "../components/Debugger"

const cm5ioHyperGraphFixtureUrl = new URL(
  "../../tests/fixtures/CM5IO_HyperGraph.json",
  import.meta.url,
).href

const cm5ioBusSelectionFixtures = [
  {
    label: "CM5IO_bus1.json",
    url: new URL("../../tests/fixtures/CM5IO_bus1.json", import.meta.url).href,
  },
  {
    label: "CM5IO_bus2.json",
    url: new URL("../../tests/fixtures/CM5IO_bus2.json", import.meta.url).href,
  },
  {
    label: "CM5IO_bus3.json",
    url: new URL("../../tests/fixtures/CM5IO_bus3.json", import.meta.url).href,
  },
] as const

const sequentialBusOrder = ["bus1", "bus3", "bus2"] as const

interface ConnectionPatchSelectionFixture extends ConnectionPatchSelection {
  busId: string
}

const mergeConnectionPatchSelections = (
  selections: ConnectionPatchSelection[],
): ConnectionPatchSelection => ({
  connectionPatches: selections.flatMap((selection) =>
    selection.connectionPatches.map(({ connectionId }) => ({ connectionId })),
  ),
})

const createThreeBusSerializedHyperGraph = (
  fullInput: SerializedHyperGraphPortPointPathingSolverInput,
  busSelections: ConnectionPatchSelection[],
): SerializedHyperGraph =>
  convertPortPointPathingSolverInputToSerializedHyperGraph(
    filterPortPointPathingSolverInputByConnectionPatches(
      fullInput,
      mergeConnectionPatchSelections(busSelections),
    ),
  )

export default function Cm5ioThreeBusRoutingPage() {
  const [serializedHyperGraph, setSerializedHyperGraph] =
    useState<SerializedHyperGraph>()
  const [busSelections, setBusSelections] =
    useState<ConnectionPatchSelectionFixture[]>()
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let isCancelled = false

    const loadFixture = async () => {
      try {
        const [fullResponse, ...busSelectionResponses] = await Promise.all([
          fetch(cm5ioHyperGraphFixtureUrl),
          ...cm5ioBusSelectionFixtures.map(({ url }) => fetch(url)),
        ])

        if (!fullResponse.ok) {
          throw new Error(
            `Failed to load CM5IO hypergraph fixture (${fullResponse.status})`,
          )
        }

        const failedSelectionIndex = busSelectionResponses.findIndex(
          (response) => !response.ok,
        )

        if (failedSelectionIndex !== -1) {
          const failedFixture =
            cm5ioBusSelectionFixtures[failedSelectionIndex]!.label
          const failedResponse = busSelectionResponses[failedSelectionIndex]!
          throw new Error(
            `Failed to load ${failedFixture} (${failedResponse.status})`,
          )
        }

        const fullInput =
          (await fullResponse.json()) as SerializedHyperGraphPortPointPathingSolverInput
        const busSelections = (await Promise.all(
          busSelectionResponses.map((response) => response.json()),
        )) as ConnectionPatchSelectionFixture[]
        const subsetSerializedHyperGraph = createThreeBusSerializedHyperGraph(
          fullInput,
          busSelections,
        )

        if (!isCancelled) {
          setSerializedHyperGraph(subsetSerializedHyperGraph)
          setBusSelections(busSelections)
          setErrorMessage(undefined)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load CM5IO three-bus subset fixture",
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

  if (!serializedHyperGraph || !busSelections) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-600">
        Loading CM5IO three-bus subset fixture...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        CM5IO <code>bus1</code>, <code>bus2</code>, and <code>bus3</code> routed
        sequentially by the centerline-only bus solver. The three bus selection
        fixtures are merged into one 43-trace subset, then the debugger routes
        them one stage at a time in <code>bus1</code> → <code>bus3</code> →{" "}
        <code>bus2</code> order so each solved bus becomes fixed occupancy for
        the next stage.
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          serializedHyperGraph={serializedHyperGraph}
          createSolver={(graph) => {
            const orderedBusSelections = sequentialBusOrder.map((busId) => {
              const matchingSelection = busSelections.find(
                (selection) => selection.busId === busId,
              )

              if (!matchingSelection) {
                throw new Error(`Missing CM5IO bus selection for "${busId}"`)
              }

              return matchingSelection
            })

            return new TinyHyperGraphSequentialBusSolver({
              serializedHyperGraph: graph,
              busStages: orderedBusSelections.map((selection) => ({
                stageName: selection.busId,
                busId: selection.busId,
                connectionIds: selection.connectionPatches.map(
                  ({ connectionId }) => connectionId,
                ),
              })),
              busSolverOptions: {
                MAX_ITERATIONS: 250_000,
              },
            })
          }}
        />
      </div>
    </div>
  )
}
