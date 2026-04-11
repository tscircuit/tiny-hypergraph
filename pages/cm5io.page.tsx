import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphBusAwareSolver,
  convertPortPointPathingSolverInputToSerializedHyperGraph,
} from "lib/index"
import { useEffect, useState } from "react"
import { Debugger } from "./components/Debugger"

const cm5ioFixtureUrl = new URL(
  "../tests/fixtures/CM5IO_HyperGraph.json",
  import.meta.url,
).href

export default function Cm5ioPage() {
  const [serializedHyperGraph, setSerializedHyperGraph] =
    useState<SerializedHyperGraph>()
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let isCancelled = false

    const loadFixture = async () => {
      try {
        const response = await fetch(cm5ioFixtureUrl)
        if (!response.ok) {
          throw new Error(`Failed to load fixture (${response.status})`)
        }

        const input = await response.json()
        const convertedSerializedHyperGraph =
          convertPortPointPathingSolverInputToSerializedHyperGraph(input)

        if (!isCancelled) {
          setSerializedHyperGraph(convertedSerializedHyperGraph)
          setErrorMessage(undefined)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load CM5IO fixture",
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
        Loading CM5IO fixture...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        CM5IO hypergraph with pre-annotated bus groups. The debugger uses
        a bus-aware explore/complete pipeline: aggressive endpoint exploration,
        completion from the best partial, then alternating rounds of hotspot
        group repair and section polish around the remaining hotspots.
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          serializedHyperGraph={serializedHyperGraph}
          createSolver={(graph) => {
            const { topology, problem } = loadSerializedHyperGraph(graph)
            return new TinyHyperGraphBusAwareSolver(topology, problem, {
              EXPLORATION_MAX_ITERATIONS: 50_000,
              COMPLETION_MAX_ITERATIONS: 200_000,
              HOTSPOT_REPAIR_MAX_ITERATIONS: 50_000,
              ALTERNATING_REPAIR_CYCLES: 3,
              HOTSPOT_GROUP_REPAIR_ROUNDS: 5,
              HOTSPOT_GROUP_CANDIDATE_LIMIT: 6,
              SECTION_POLISH_ROUNDS: 3,
              SECTION_POLISH_MAX_HOT_REGIONS: 4,
              SECTION_POLISH_MAX_ITERATIONS: 500_000,
            })
          }}
        />
      </div>
    </div>
  )
}
