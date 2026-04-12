import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  TinyHyperGraphSolver,
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
        CM5IO hypergraph fixture. The debugger uses a `MAX_ITERATIONS` budget
        of `50_000`.
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          serializedHyperGraph={serializedHyperGraph}
          createSolver={(graph) => {
            const { topology, problem } = loadSerializedHyperGraph(graph)
            return new TinyHyperGraphSolver(topology, problem, {
              MAX_ITERATIONS: 50_000,
            })
          }}
        />
      </div>
    </div>
  )
}
