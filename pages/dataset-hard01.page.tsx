import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "lib/index"
import { type ChangeEvent, useEffect, useState } from "react"
import * as datasetHard01 from "../datasets/hard01"
import { Debugger } from "./components/Debugger"

type Hard01SampleMeta = {
  sampleName: string
  circuitKey: string
  circuitId: string
  stepsToPortPointSolve: number
  sourceSampleNumber: number
  solveGraphOptions?: Record<string, unknown> | null
}

const datasetModule = datasetHard01 as Record<string, unknown> & {
  manifest: {
    sampleCount: number
    samples: Hard01SampleMeta[]
  }
}

const SAMPLE_HASH_PARAM = "sample"

const clampSampleIndex = (sampleIndex: number) =>
  Math.min(
    Math.max(Number.isFinite(sampleIndex) ? sampleIndex : 0, 0),
    datasetModule.manifest.sampleCount - 1,
  )

const getSampleIndexFromSampleNumber = (sampleNumber: number) => {
  const matchingIndex = datasetModule.manifest.samples.findIndex(
    (sample) =>
      sample.sourceSampleNumber === sampleNumber ||
      sample.sampleName === `sample${String(sampleNumber).padStart(3, "0")}`,
  )

  return matchingIndex >= 0 ? matchingIndex : null
}

const getSampleIndexFromHash = () => {
  if (typeof window === "undefined") return 0

  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const sampleNumber = Number(hashParams.get(SAMPLE_HASH_PARAM))

  if (!Number.isFinite(sampleNumber)) return 0
  return getSampleIndexFromSampleNumber(sampleNumber) ?? clampSampleIndex(0)
}

const setSampleInHash = (sampleMeta: Hard01SampleMeta) => {
  if (typeof window === "undefined") return

  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.slice(1))
  hashParams.set(SAMPLE_HASH_PARAM, String(sampleMeta.sourceSampleNumber))
  url.hash = hashParams.toString()

  window.history.replaceState(window.history.state, "", url)
}

const normalizeSolverOptions = (
  rawOptions: Record<string, unknown> | null | undefined,
): TinyHyperGraphSolverOptions | undefined => {
  if (!rawOptions) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(rawOptions)
      .map(([key, value]) => [
        key,
        key === "EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST" &&
        value === null
          ? Number.POSITIVE_INFINITY
          : value,
      ])
      .filter(([, value]) => value !== null),
  ) as TinyHyperGraphSolverOptions
}

export default function DatasetHard01Page() {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(
    getSampleIndexFromHash,
  )

  useEffect(() => {
    const syncSelectedSampleFromHash = () => {
      setSelectedSampleIndex(getSampleIndexFromHash())
    }

    window.addEventListener("hashchange", syncSelectedSampleFromHash)
    return () =>
      window.removeEventListener("hashchange", syncSelectedSampleFromHash)
  }, [])

  const selectedSampleMeta =
    datasetModule.manifest.samples[selectedSampleIndex] ??
    datasetModule.manifest.samples[0]!
  const selectedSample = datasetModule[
    selectedSampleMeta.sampleName
  ] as SerializedHyperGraph

  useEffect(() => {
    setSampleInHash(selectedSampleMeta)
  }, [selectedSampleMeta])

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Sample</span>
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1"
            type="number"
            value={selectedSampleMeta.sourceSampleNumber}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const sampleIndex = getSampleIndexFromSampleNumber(
                Number(event.currentTarget.value),
              )

              if (sampleIndex !== null) {
                setSelectedSampleIndex(sampleIndex)
              }
            }}
          />
        </label>
        <button
          className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
          disabled={selectedSampleIndex === 0}
          onClick={() =>
            setSelectedSampleIndex((index) => Math.max(index - 1, 0))
          }
          type="button"
        >
          Previous
        </button>
        <button
          className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
          disabled={
            selectedSampleIndex === datasetModule.manifest.sampleCount - 1
          }
          onClick={() =>
            setSelectedSampleIndex((index) =>
              Math.min(index + 1, datasetModule.manifest.sampleCount - 1),
            )
          }
          type="button"
        >
          Next
        </button>
        <div className="text-sm text-slate-700">
          {selectedSampleMeta.sampleName} • dataset01 sample{" "}
          {selectedSampleMeta.sourceSampleNumber} •{" "}
          {selectedSampleMeta.circuitKey} •{" "}
          {selectedSampleMeta.stepsToPortPointSolve} reference steps
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          key={selectedSampleMeta.sampleName}
          serializedHyperGraph={selectedSample}
          createSolver={(serializedHyperGraph) => {
            const { topology, problem } =
              loadSerializedHyperGraph(serializedHyperGraph)
            return new TinyHyperGraphSolver(
              topology,
              problem,
              normalizeSolverOptions(selectedSampleMeta.solveGraphOptions),
            )
          }}
        />
      </div>
    </div>
  )
}
