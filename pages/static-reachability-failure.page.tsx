import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { useEffect, useState } from "react"
import { Debugger } from "./components/Debugger"

const staticReachabilityFailureFixtureUrl = new URL(
  "../tests/fixtures/portPointPathingSolver_input_2.json",
  import.meta.url,
).href

export default function StaticReachabilityFailurePage() {
  const [serializedHyperGraph, setSerializedHyperGraph] =
    useState<SerializedHyperGraph>()
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let isCancelled = false

    const loadFixture = async () => {
      try {
        const response = await fetch(staticReachabilityFailureFixtureUrl)
        if (!response.ok) {
          throw new Error(
            `Failed to load static reachability fixture (${response.status})`,
          )
        }

        const input =
          (await response.json()) as SerializedHyperGraphPortPointPathingSolverInput
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
              : "Failed to load static reachability fixture",
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
        Loading static reachability fixture...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
        Static reachability failure fixture. The generic solver debugger runs
        the core <code>TinyHyperGraphSolver</code> with its static precheck
        enabled so <code>visualize()</code> shows only the problematic failed
        traces.
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-slate-300 bg-white">
        <Debugger
          serializedHyperGraph={serializedHyperGraph}
          createSolver={(graph) => {
            const { topology, problem } = loadSerializedHyperGraph(graph)
            return new TinyHyperGraphSolver(topology, problem, {
              MAX_ITERATIONS: 50_000,
              STATIC_REACHABILITY_PRECHECK: true,
            })
          }}
        />
      </div>
    </div>
  )
}
