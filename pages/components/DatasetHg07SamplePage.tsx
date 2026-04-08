import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { BaseSolver } from "@tscircuit/solver-utils"
import * as datasetHg07 from "dataset-hg07"
import { type ChangeEvent, useEffect, useState } from "react"
import { Debugger } from "./Debugger"

const datasetModule = datasetHg07 as Record<string, unknown> & {
  manifest: {
    sampleCount: number
    samples: Array<{
      sampleName: string
      circuitKey: string
      circuitId: string
      stepsToPortPointSolve: number
    }>
  }
}

const SAMPLE_HASH_PARAM = "sample"

const clampSampleIndex = (sampleIndex: number) =>
  Math.min(
    Math.max(Number.isFinite(sampleIndex) ? sampleIndex : 0, 0),
    datasetModule.manifest.sampleCount - 1,
  )

const getSampleIndexFromHash = () => {
  if (typeof window === "undefined") return 0

  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const sampleNumber = Number(hashParams.get(SAMPLE_HASH_PARAM))

  if (!Number.isFinite(sampleNumber)) return 0
  return clampSampleIndex(sampleNumber - 1)
}

const setSampleIndexInHash = (sampleIndex: number) => {
  if (typeof window === "undefined") return

  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.slice(1))
  hashParams.set(SAMPLE_HASH_PARAM, String(sampleIndex + 1))
  url.hash = hashParams.toString()

  window.history.replaceState(window.history.state, "", url)
}

export const DatasetHg07SamplePage = ({
  modeLabel,
  createSolver,
}: {
  modeLabel: string
  createSolver: (serializedHyperGraph: SerializedHyperGraph) => BaseSolver
}) => {
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

  useEffect(() => {
    setSampleIndexInHash(selectedSampleIndex)
  }, [selectedSampleIndex])

  const selectedSampleMeta =
    datasetModule.manifest.samples[selectedSampleIndex] ??
    datasetModule.manifest.samples[0]
  const selectedSample = datasetModule[
    selectedSampleMeta.sampleName
  ] as SerializedHyperGraph

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Sample</span>
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1"
            type="number"
            min={1}
            max={datasetModule.manifest.sampleCount}
            value={selectedSampleIndex + 1}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSelectedSampleIndex(
                clampSampleIndex(Number(event.currentTarget.value) - 1),
              )
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
          {selectedSampleMeta.sampleName} • circuit{" "}
          {selectedSampleMeta.circuitId}
          {" • "}
          {selectedSampleMeta.stepsToPortPointSolve} reference steps
          {" • "}
          {modeLabel}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          key={`${modeLabel}:${selectedSampleMeta.sampleName}`}
          serializedHyperGraph={selectedSample}
          createSolver={createSolver}
        />
      </div>
    </div>
  )
}
