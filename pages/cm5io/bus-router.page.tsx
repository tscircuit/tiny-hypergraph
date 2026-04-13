import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { SerializedHyperGraphPortPointPathingSolverInput } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type TinyHyperGraphBusData,
  TinyHyperGraphBusRouterPipelineSolver,
} from "lib/index"
import { useEffect, useState } from "react"
import { Debugger } from "../components/Debugger"

const cm5ioFixtureUrl = new URL(
  "../../tests/fixtures/CM5IO_HyperGraph.json",
  import.meta.url,
).href

const cm5ioBusFixtureUrl = new URL(
  "../../tests/fixtures/CM5IO_bus1.json",
  import.meta.url,
).href

export default function Cm5ioBusRouterPage() {
  const [serializedHyperGraph, setSerializedHyperGraph] =
    useState<SerializedHyperGraph>()
  const [busData, setBusData] = useState<TinyHyperGraphBusData>()
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let isCancelled = false

    const loadFixtures = async () => {
      try {
        const [graphResponse, busResponse] = await Promise.all([
          fetch(cm5ioFixtureUrl),
          fetch(cm5ioBusFixtureUrl),
        ])

        if (!graphResponse.ok) {
          throw new Error(
            `Failed to load CM5IO fixture (${graphResponse.status})`,
          )
        }

        if (!busResponse.ok) {
          throw new Error(
            `Failed to load CM5IO bus fixture (${busResponse.status})`,
          )
        }

        const input =
          (await graphResponse.json()) as SerializedHyperGraphPortPointPathingSolverInput
        const nextBusData = (await busResponse.json()) as TinyHyperGraphBusData
        const convertedSerializedHyperGraph =
          convertPortPointPathingSolverInputToSerializedHyperGraph(input)

        if (!isCancelled) {
          setSerializedHyperGraph(convertedSerializedHyperGraph)
          setBusData(nextBusData)
          setErrorMessage(undefined)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load CM5IO bus router fixtures",
          )
        }
      }
    }

    void loadFixtures()

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

  if (!serializedHyperGraph || !busData) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-600">
        Loading CM5IO bus router fixtures...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        CM5IO bus router pipeline debug page for <code>{busData.busId}</code>.
        The pipeline runs the no-intersection-cost baseline bus routing stage
        first, then computes a 20-segment centerline from the routed bus traces.
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        <div>
          <span className="font-medium">Bus</span>: {busData.busId}
        </div>
        <div>
          <span className="font-medium">Connections</span>:{" "}
          {busData.connectionPatches.length}
        </div>
        <div>
          <span className="font-medium">Points</span>: {busData.pointIds.length}
        </div>
        <div>
          <span className="font-medium">Centerline Segments</span>: 20
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Debugger
          key={`${busData.busId}:${busData.connectionPatches.length}`}
          serializedHyperGraph={serializedHyperGraph}
          createSolver={(graph) =>
            new TinyHyperGraphBusRouterPipelineSolver({
              serializedHyperGraph: graph,
              bus: busData,
              baselineSolverOptions: {
                DISTANCE_TO_COST: 0.05,
                MAX_ITERATIONS: 200_000,
              },
              centerlineSegmentCount: 20,
            })
          }
        />
      </div>
    </div>
  )
}
