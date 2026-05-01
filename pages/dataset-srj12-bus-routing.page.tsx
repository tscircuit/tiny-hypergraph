import {
  samples as busDatasetSamples,
  type TinyHypergraphBenchmarkCase,
} from "@tsci/tscircuit.dataset-srj12-bus-routing"
import type { BaseSolver } from "@tscircuit/solver-utils"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphBusSolver,
  TinyHyperGraphSolver,
  TinyHyperGraphSectionPipelineSolver,
} from "lib/index"
import { type ChangeEvent, useEffect, useMemo, useState } from "react"
import { Debugger } from "./components/Debugger"

type BusDatasetSample = {
  sampleName: string
  tinyHypergraphBenchmark: TinyHypergraphBenchmarkCase
}

type SolverMode = "core" | "section" | "bus"

const datasetSamples = busDatasetSamples as BusDatasetSample[]
const SAMPLE_HASH_PARAM = "sample"
const MODE_HASH_PARAM = "mode"
const BUS_CENTER_PORT_OPTIONS_PER_EDGE = 16

const clampSampleIndex = (sampleIndex: number) =>
  Math.min(
    Math.max(Number.isFinite(sampleIndex) ? sampleIndex : 0, 0),
    datasetSamples.length - 1,
  )

const getHashParams = () => {
  if (typeof window === "undefined") {
    return new URLSearchParams()
  }

  return new URLSearchParams(window.location.hash.slice(1))
}

const getSampleIndexFromHash = () => {
  const hashParams = getHashParams()
  const sampleNumber = Number(hashParams.get(SAMPLE_HASH_PARAM))

  if (!Number.isFinite(sampleNumber)) return 0
  return clampSampleIndex(sampleNumber - 1)
}

const getSolverModeFromHash = (): SolverMode => {
  const hashParams = getHashParams()
  const mode = hashParams.get(MODE_HASH_PARAM)

  if (mode === "bus" || mode === "section") {
    return mode
  }

  return "core"
}

const setPageStateInHash = (sampleIndex: number, solverMode: SolverMode) => {
  if (typeof window === "undefined") return

  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.slice(1))
  hashParams.set(SAMPLE_HASH_PARAM, String(sampleIndex + 1))
  hashParams.set(MODE_HASH_PARAM, solverMode)
  url.hash = hashParams.toString()

  window.history.replaceState(window.history.state, "", url)
}

const formatMetric = (value: unknown, digits = 6) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "n/a"

const formatValue = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "n/a"

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
  }
}

const createBusSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  return new TinyHyperGraphBusSolver(topology, problem, {
    MAX_ITERATIONS: 250_000,
    CENTER_PORT_OPTIONS_PER_EDGE: BUS_CENTER_PORT_OPTIONS_PER_EDGE,
    VISUALIZE_UNASSIGNED_PORTS: true,
  })
}

const createCoreSolver = (serializedHyperGraph: SerializedHyperGraph) => {
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  return new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 250_000,
  })
}

const createSectionPipelineSolver = (
  serializedHyperGraph: SerializedHyperGraph,
) =>
  new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph,
  })

const getCreateSolver = (solverMode: SolverMode) =>
  solverMode === "core"
    ? createCoreSolver
    : solverMode === "section"
      ? createSectionPipelineSolver
      : createBusSolver

export default function DatasetSrj12BusRoutingPage() {
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(
    getSampleIndexFromHash,
  )
  const [solverMode, setSolverMode] = useState<SolverMode>(
    getSolverModeFromHash,
  )

  useEffect(() => {
    const syncStateFromHash = () => {
      setSelectedSampleIndex(getSampleIndexFromHash())
      setSolverMode(getSolverModeFromHash())
    }

    window.addEventListener("hashchange", syncStateFromHash)
    return () => window.removeEventListener("hashchange", syncStateFromHash)
  }, [])

  useEffect(() => {
    setPageStateInHash(selectedSampleIndex, solverMode)
  }, [selectedSampleIndex, solverMode])

  const selectedSample =
    datasetSamples[selectedSampleIndex] ?? datasetSamples[0]!
  const benchmarkCase = selectedSample.tinyHypergraphBenchmark
  const serializedHyperGraph = useMemo(
    () => normalizeSerializedHyperGraph(benchmarkCase),
    [benchmarkCase],
  )
  const stats = benchmarkCase.stats
  const resultSummary = benchmarkCase.resultSummary
  const createSolver = getCreateSolver(solverMode) as (
    serializedHyperGraph: SerializedHyperGraph,
  ) => BaseSolver

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Sample</span>
          <input
            className="w-24 rounded border border-slate-300 px-2 py-1"
            type="number"
            min={1}
            max={datasetSamples.length}
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
          disabled={selectedSampleIndex === datasetSamples.length - 1}
          onClick={() =>
            setSelectedSampleIndex((index) =>
              Math.min(index + 1, datasetSamples.length - 1),
            )
          }
          type="button"
        >
          Next
        </button>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Solver</span>
          <select
            className="rounded border border-slate-300 px-2 py-1"
            value={solverMode}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setSolverMode(event.currentTarget.value as SolverMode)
            }}
          >
            <option value="core">Core solver</option>
            <option value="section">Section pipeline</option>
            <option value="bus">Bus solver</option>
          </select>
        </label>
        <div className="text-sm text-slate-700">
          {selectedSample.sampleName} •{" "}
          {formatValue(resultSummary.connectionCount)} traces •{" "}
          {formatValue(resultSummary.regionCount)} regions •{" "}
          {formatValue(resultSummary.portCount)} ports
        </div>
      </div>
      <div className="grid gap-3 rounded border border-slate-300 bg-white p-3 text-sm text-slate-700 md:grid-cols-5">
        <div>
          <div className="font-medium text-slate-900">Dataset result</div>
          <div>
            solved={String(resultSummary.solved)} failed=
            {String(resultSummary.failed)}
          </div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Iterations</div>
          <div>{String(resultSummary.iterations)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Baseline cost</div>
          <div>{formatMetric(stats.sectionSearchBaselineMaxRegionCost)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Final cost</div>
          <div>{formatMetric(stats.sectionSearchFinalMaxRegionCost)}</div>
        </div>
        <div>
          <div className="font-medium text-slate-900">Selected section</div>
          <div>{String(stats.selectedSectionCandidateLabel ?? "none")}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Debugger
          key={`${selectedSample.sampleName}-${solverMode}`}
          serializedHyperGraph={serializedHyperGraph}
          createSolver={createSolver}
        />
      </div>
    </div>
  )
}
