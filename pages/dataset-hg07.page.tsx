import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { useState } from "react"
import { Debugger } from "./components/Debugger"

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

export default function DatasetHg07Page() {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0)

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
            onChange={(event: any) => {
              const rawIndex = Number(event.currentTarget.value) - 1
              const clampedIndex = Math.min(
                Math.max(Number.isFinite(rawIndex) ? rawIndex : 0, 0),
                datasetModule.manifest.sampleCount - 1,
              )
              setSelectedSampleIndex(clampedIndex)
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
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          key={selectedSampleMeta.sampleName}
          serializedHyperGraph={selectedSample}
        />
      </div>
    </div>
  )
}
