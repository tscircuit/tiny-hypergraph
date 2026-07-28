import type { SerializedHyperGraphPortPointPathingSolverInput } from "../../lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "../../lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph as loadSerializedHyperGraph2 } from "../../lib2/graph-load"
import { TinyHyperGraphSolver2 } from "../../lib2/index"

const CM5IO_FIXTURE_URL = new URL(
  "../../tests/fixtures/CM5IO_HyperGraph.json",
  import.meta.url,
)

const MAX_ITERATIONS = 10_000_000

const formatSeconds = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(3)}s`
const formatMetric = (value: number) => value.toFixed(3)
const formatOptionalMetric = (value: number | null) =>
  value === null ? "n/a" : formatMetric(value)

const getMaxRegionCost = (solver: {
  state: {
    regionIntersectionCaches: ArrayLike<{
      existingRegionCost: number
    }>
  }
}) =>
  Array.from(solver.state.regionIntersectionCaches).reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const average = (values: number[]) =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length

const parseArgs = () => ({
  verbose: process.argv.includes("--verbose") || process.argv.includes("-v"),
  solverVariant: process.argv.includes("--solver")
    ? process.argv[process.argv.indexOf("--solver") + 1]
    : "core",
})

class BenchmarkTinyHyperGraphSolver extends TinyHyperGraphSolver {
  maxRegionCostsBeforeRip: number[] = []

  override onAllRoutesRouted() {
    const previousRipCount = this.state.ripCount
    const maxRegionCostBeforeRip = getMaxRegionCost(this)
    super.onAllRoutesRouted()

    if (this.state.ripCount > previousRipCount) {
      this.maxRegionCostsBeforeRip.push(maxRegionCostBeforeRip)
    }
  }

  override onOutOfCandidates() {
    const previousRipCount = this.state.ripCount
    const maxRegionCostBeforeRip = getMaxRegionCost(this)
    super.onOutOfCandidates()

    if (this.state.ripCount > previousRipCount) {
      this.maxRegionCostsBeforeRip.push(maxRegionCostBeforeRip)
    }
  }
}

const main = async () => {
  const { verbose, solverVariant } = parseArgs()
  if (solverVariant !== "core" && solverVariant !== "lib2") {
    throw new Error(`Invalid --solver value: ${solverVariant ?? "<missing>"}`)
  }
  const input = (await Bun.file(
    CM5IO_FIXTURE_URL,
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const { topology, problem } =
    solverVariant === "lib2"
      ? loadSerializedHyperGraph2(serializedHyperGraph)
      : loadSerializedHyperGraph(serializedHyperGraph)
  const Solver =
    solverVariant === "lib2"
      ? class BenchmarkTinyHyperGraphSolver2 extends TinyHyperGraphSolver2 {
          maxRegionCostsBeforeRip: number[] = []

          override onAllRoutesRouted() {
            const previousRipCount = this.state.ripCount
            const maxRegionCostBeforeRip = getMaxRegionCost(this)
            super.onAllRoutesRouted()

            if (this.state.ripCount > previousRipCount) {
              this.maxRegionCostsBeforeRip.push(maxRegionCostBeforeRip)
            }
          }

          override onOutOfCandidates() {
            const previousRipCount = this.state.ripCount
            const maxRegionCostBeforeRip = getMaxRegionCost(this)
            super.onOutOfCandidates()

            if (this.state.ripCount > previousRipCount) {
              this.maxRegionCostsBeforeRip.push(maxRegionCostBeforeRip)
            }
          }
        }
      : BenchmarkTinyHyperGraphSolver
  const solver = new Solver(topology, problem, {
    MAX_ITERATIONS,
    VERBOSE: verbose,
  })

  const startTime = performance.now()
  solver.solve()
  const durationMs = performance.now() - startTime
  const avgMaxRegionBeforeRip = average(solver.maxRegionCostsBeforeRip)
  const error =
    solver.error?.replace(
      "BenchmarkTinyHyperGraphSolver",
      "TinyHyperGraphSolver",
    ) ?? null

  console.log(`benchmark=cm5io solver=${solverVariant}`)
  console.log(
    [
      `maxIterations=${MAX_ITERATIONS}`,
      `routeCount=${problem.routeCount}`,
      `regionCount=${topology.regionCount}`,
      `portCount=${topology.portCount}`,
      `ripCount=${solver.state.ripCount}`,
      `avgMaxRegionBeforeRip=${formatOptionalMetric(avgMaxRegionBeforeRip)}`,
      `duration=${formatSeconds(durationMs)}`,
    ].join(" "),
  )
  console.log(
    [
      `status=${solver.solved && !solver.failed ? "solved" : "failed"}`,
      `solved=${solver.solved}`,
      `failed=${solver.failed}`,
      `error=${JSON.stringify(error)}`,
    ].join(" "),
  )
}

await main()
