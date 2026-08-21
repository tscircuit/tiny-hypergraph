import manifestJson from "../datasets/srj18-pipeline7/manifest.json"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { type ChangeEvent, useEffect, useMemo, useState } from "react"
import {
  TinyHyperGraphSectionPipelineSolver,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "lib/index"
import { Debugger } from "./components/Debugger"

type Srj18Pipeline7Case = {
  sampleName: string
  extractionStatus: "success" | "failed"
  extractionError: string | null
  solverInput?: {
    serializedHyperGraph: SerializedHyperGraph
    solveGraphOptions?: TinyHyperGraphSolverOptions
    sectionSolverOptions?: TinyHyperGraphSectionSolverOptions
  }
  resultSummary: Record<string, unknown>
}

type Srj18Pipeline7Manifest = {
  sampleCount: number
  generatedBy: {
    autorouterCommit: string
    pipeline: string
  }
  cases: Array<{
    sampleName: string
    extractionStatus: "success" | "failed"
    extractionError: string | null
    resultSummary: Record<string, unknown>
  }>
}

type ImportGlob = <T>(
  pattern: string,
  options?: { import?: string },
) => Record<string, () => Promise<T>>

const datasetManifest = manifestJson as Srj18Pipeline7Manifest
const SAMPLE_HASH_PARAM = "sample"
const tinyHypergraphBenchmarkLoaders = (
  import.meta as ImportMeta & { glob: ImportGlob }
).glob<Srj18Pipeline7Case>(
  "../datasets/srj18-pipeline7/*.tiny-hypergraph.json",
  { import: "default" },
)

const clampSampleIndex = (sampleIndex: number) =>
  Math.min(
    Math.max(Number.isFinite(sampleIndex) ? sampleIndex : 0, 0),
    datasetManifest.sampleCount - 1,
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

const formatValue = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "n/a"

const getTinyHypergraphBenchmarkLoader = (sampleName: string) =>
  tinyHypergraphBenchmarkLoaders[
    `../datasets/srj18-pipeline7/${sampleName}.tiny-hypergraph.json`
  ]

export default function DatasetSrj18Pipeline7Page() {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(
    getSampleIndexFromHash,
  )
  const [benchmarkCase, setBenchmarkCase] = useState<Srj18Pipeline7Case | null>(
    null,
  )
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

  const selectedSampleMeta =
    datasetManifest.cases[selectedSampleIndex] ?? datasetManifest.cases[0]!

  useEffect(() => {
    let cancelled = false
    setBenchmarkCase(null)
    setLoadError(null)

    const loadBenchmarkCase = async () => {
      const load = getTinyHypergraphBenchmarkLoader(
        selectedSampleMeta.sampleName,
      )

      if (!load) {
        throw new Error(
          `Missing tiny-hypergraph benchmark for ${selectedSampleMeta.sampleName}`,
        )
      }

      const nextBenchmarkCase = await load()
      if (!cancelled) {
        setBenchmarkCase(nextBenchmarkCase)
      }
    }

    loadBenchmarkCase().catch((error) => {
      if (!cancelled) {
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    })

    return () => {
      cancelled = true
    }
  }, [selectedSampleMeta.sampleName])

  const solverInput = benchmarkCase?.solverInput
  const serializedHyperGraph = useMemo(
    () => solverInput?.serializedHyperGraph,
    [solverInput],
  )
  const resultSummary = selectedSampleMeta.resultSummary

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Sample</span>
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1"
            type="number"
            min={1}
            max={datasetManifest.sampleCount}
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
          disabled={selectedSampleIndex === datasetManifest.sampleCount - 1}
          onClick={() =>
            setSelectedSampleIndex((index) =>
              Math.min(index + 1, datasetManifest.sampleCount - 1),
            )
          }
          type="button"
        >
          Next
        </button>
        <div className="text-sm text-slate-700">
          {selectedSampleMeta.sampleName} • srj18 pipeline 7 • section pipeline
        </div>
      </div>
      <div className="grid gap-3 rounded border border-slate-300 bg-white p-3 text-sm text-slate-700 md:grid-cols-5">
        <div>
          <div className="font-medium text-slate-900">Capture</div>
          <div>{datasetManifest.generatedBy.autorouterCommit.slice(0, 7)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Connections</div>
          <div>{formatValue(resultSummary.connectionCount)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Regions</div>
          <div>{formatValue(resultSummary.regionCount)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Ports</div>
          <div>{formatValue(resultSummary.portCount)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Pipeline Iterations</div>
          <div>{formatValue(resultSummary.pipelineIterations)}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {loadError ? (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {loadError}
          </div>
        ) : serializedHyperGraph && solverInput ? (
          <Debugger
            key={selectedSampleMeta.sampleName}
            serializedHyperGraph={serializedHyperGraph}
            createSolver={() =>
              new TinyHyperGraphSectionPipelineSolver({
                serializedHyperGraph,
                solveGraphOptions: solverInput.solveGraphOptions,
                sectionSolverOptions: solverInput.sectionSolverOptions,
                createSectionMask: ({ topology }) =>
                  new Int8Array(topology.portCount),
              })
            }
          />
        ) : (
          <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-700">
            Loading {selectedSampleMeta.sampleName}
          </div>
        )}
      </div>
    </div>
  )
}
