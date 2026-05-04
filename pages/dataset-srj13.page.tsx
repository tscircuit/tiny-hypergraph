import datasetDistManifest from "@tsci/seveibar.dataset-srj13/dataset-dist/manifest.json"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { type ChangeEvent, useEffect, useMemo, useState } from "react"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "lib/index"
import { Debugger } from "./components/Debugger"

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

type TinyHypergraphBenchmarkCase = {
  sampleName: string
  generatedBy: {
    phase: string
  }
  solverInput: JsonValue
  resultSummary: Record<string, JsonValue>
}

type Srj13Manifest = {
  generatedBy: {
    phase: string
  }
  cases: Array<{
    sampleName: string
    resultSummary: Record<string, JsonValue>
  }>
}

type ImportGlob = <T>(
  pattern: string,
  options?: { import?: string },
) => Record<string, () => Promise<T>>

const datasetManifest = datasetDistManifest as Srj13Manifest
const SAMPLE_HASH_PARAM = "sample"
const DEFAULT_MAX_ITERATIONS = 250_000
const tinyHypergraphBenchmarkLoaders = (
  import.meta as ImportMeta & { glob: ImportGlob }
).glob<TinyHypergraphBenchmarkCase>(
  "../node_modules/@tsci/seveibar.dataset-srj13/dataset-dist/*.tiny-hypergraph.json",
  { import: "default" },
)

const clampSampleIndex = (sampleIndex: number) =>
  Math.min(
    Math.max(Number.isFinite(sampleIndex) ? sampleIndex : 0, 0),
    datasetManifest.cases.length - 1,
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
    `../node_modules/@tsci/seveibar.dataset-srj13/dataset-dist/${sampleName}.tiny-hypergraph.json`
  ]

const normalizeSerializedHyperGraph = (
  benchmarkCase: TinyHypergraphBenchmarkCase,
): SerializedHyperGraph => {
  const solverInput = benchmarkCase.solverInput as {
    graph: {
      regions: Array<Record<string, unknown>>
      ports: SerializedHyperGraph["ports"]
    }
    connections: NonNullable<SerializedHyperGraph["connections"]>
  }

  return {
    ...solverInput,
    regions: solverInput.graph.regions.map((region) => ({
      ...region,
      pointIds: Array.isArray(region.pointIds)
        ? region.pointIds
        : Array.isArray(region.portIds)
          ? region.portIds
          : [],
    })) as SerializedHyperGraph["regions"],
    ports: solverInput.graph.ports,
    connections: solverInput.connections,
  } as SerializedHyperGraph
}

const getSolverOptions = (
  benchmarkCase: TinyHypergraphBenchmarkCase,
): TinyHyperGraphSolverOptions => {
  const solverInput = benchmarkCase.solverInput as {
    minViaPadDiameter?: unknown
    min_via_pad_diameter?: unknown
  }
  const minViaPadDiameter = Number(
    solverInput.minViaPadDiameter ?? solverInput.min_via_pad_diameter,
  )

  return {
    MAX_ITERATIONS: DEFAULT_MAX_ITERATIONS,
    ...(Number.isFinite(minViaPadDiameter) && minViaPadDiameter > 0
      ? { minViaPadDiameter }
      : {}),
  }
}

export default function DatasetSrj13Page() {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(
    getSampleIndexFromHash,
  )
  const [benchmarkCase, setBenchmarkCase] =
    useState<TinyHypergraphBenchmarkCase | null>(null)
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

  const serializedHyperGraph = useMemo(
    () =>
      benchmarkCase ? normalizeSerializedHyperGraph(benchmarkCase) : undefined,
    [benchmarkCase],
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
            max={datasetManifest.cases.length}
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
          disabled={selectedSampleIndex === datasetManifest.cases.length - 1}
          onClick={() =>
            setSelectedSampleIndex((index) =>
              Math.min(index + 1, datasetManifest.cases.length - 1),
            )
          }
          type="button"
        >
          Next
        </button>
        <div className="text-sm text-slate-700">
          {selectedSampleMeta.sampleName} • core solver • max{" "}
          {DEFAULT_MAX_ITERATIONS.toLocaleString()} iterations
        </div>
      </div>
      <div className="grid gap-3 rounded border border-slate-300 bg-white p-3 text-sm text-slate-700 md:grid-cols-5">
        <div>
          <div className="font-medium text-slate-900">Dataset Capture</div>
          <div>
            phase={formatValue(datasetManifest.generatedBy.phase)} solved=
            {String(resultSummary.solved)}
          </div>
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
        ) : serializedHyperGraph && benchmarkCase ? (
          <Debugger
            key={selectedSampleMeta.sampleName}
            serializedHyperGraph={serializedHyperGraph}
            createSolver={() => {
              const { topology, problem } =
                loadSerializedHyperGraph(serializedHyperGraph)
              return new TinyHyperGraphSolver(
                topology,
                problem,
                getSolverOptions(benchmarkCase),
              )
            }}
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
