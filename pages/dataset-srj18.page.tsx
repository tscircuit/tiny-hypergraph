import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { type ChangeEvent, useEffect, useState } from "react"
import { TinyHyperGraphSectionPipelineSolver } from "lib/index"
import { Debugger } from "./components/Debugger"

const SAMPLE_HASH_PARAM = "sample"
const SAMPLE_NAMES = Array.from(
  { length: 16 },
  (_, index) => `sample${String(index + 1).padStart(3, "0")}`,
)
const SRJ18_DATASET_COMMIT = "cafe0b46c28e6101d0e8d1b8ea184fdeebc5cc1a"
const SRJ18_HYPERGRAPH_BASE_URL = `https://raw.githubusercontent.com/tscircuit/dataset-srj18/${SRJ18_DATASET_COMMIT}/generated-datasets/srj18`

const clampSampleIndex = (sampleIndex: number) =>
  Math.min(
    Math.max(Number.isFinite(sampleIndex) ? sampleIndex : 0, 0),
    SAMPLE_NAMES.length - 1,
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

const loadSrj18Sample = async (
  sampleName: string,
  signal: AbortSignal,
): Promise<SerializedHyperGraph> => {
  const response = await fetch(
    `${SRJ18_HYPERGRAPH_BASE_URL}/${sampleName}.hg.json`,
    { signal },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load ${sampleName}.hg.json from dataset-srj18 generated-datasets: ${response.status} ${response.statusText}`,
    )
  }

  return (await response.json()) as SerializedHyperGraph
}

export default function DatasetSrj18Page() {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(
    getSampleIndexFromHash,
  )
  const [serializedHyperGraph, setSerializedHyperGraph] =
    useState<SerializedHyperGraph | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  const selectedSampleName =
    SAMPLE_NAMES[selectedSampleIndex] ?? SAMPLE_NAMES[0]!

  useEffect(() => {
    let cancelled = false
    const abortController = new AbortController()
    setSerializedHyperGraph(null)
    setLoadError(null)

    const loadSample = async () => {
      const nextSerializedHyperGraph = await loadSrj18Sample(
        selectedSampleName,
        abortController.signal,
      )
      if (!cancelled) {
        setSerializedHyperGraph(nextSerializedHyperGraph)
      }
    }

    loadSample().catch((error) => {
      if (!cancelled) {
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    })

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [selectedSampleName])

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Sample</span>
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1"
            type="number"
            min={1}
            max={SAMPLE_NAMES.length}
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
          disabled={selectedSampleIndex === SAMPLE_NAMES.length - 1}
          onClick={() =>
            setSelectedSampleIndex((index) =>
              Math.min(index + 1, SAMPLE_NAMES.length - 1),
            )
          }
          type="button"
        >
          Next
        </button>
        <div className="text-sm text-slate-700">
          {selectedSampleName} • srj18 • dynamic {selectedSampleIndex + 1}/
          {SAMPLE_NAMES.length}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {loadError ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-medium">
              Failed to load srj18 sample: {selectedSampleName}
            </div>
            <div className="mt-1">{loadError}</div>
          </div>
        ) : serializedHyperGraph ? (
          <Debugger
            key={selectedSampleName}
            serializedHyperGraph={serializedHyperGraph}
            createSolver={(nextSerializedHyperGraph) =>
              new TinyHyperGraphSectionPipelineSolver({
                serializedHyperGraph: nextSerializedHyperGraph,
              })
            }
          />
        ) : (
          <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
            Loading {selectedSampleName}
          </div>
        )}
      </div>
    </div>
  )
}
