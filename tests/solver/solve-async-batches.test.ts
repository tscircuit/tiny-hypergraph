import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { DistanceAwareTinyHyperGraphSolver } from "../../lib/distance-aware-tiny-hypergraph-solver"
import { sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("ordered route batches preserve serial output across conflicting speculative prefixes", async () => {
  const create = () => {
    const { topology, problem } = loadSerializedHyperGraph(
      sectionSolverFixtureGraph,
    )
    const starts = problem.routeStartPort
    const ends = problem.routeEndPort
    const nets = problem.routeNet
    const metadata = problem.routeMetadata
    problem.routeCount = 20
    problem.routeStartPort = Int32Array.from(
      { length: 20 },
      (_, index) => starts[index % starts.length],
    )
    problem.routeEndPort = Int32Array.from(
      { length: 20 },
      (_, index) => ends[index % ends.length],
    )
    problem.routeNet = Int32Array.from(
      { length: 20 },
      (_, index) => nets[index % nets.length],
    )
    problem.routeMetadata = Array.from({ length: 20 }, (_, index) => ({
      ...metadata?.[index % starts.length],
      connectionId: `route-${index}`,
    }))
    return new DistanceAwareTinyHyperGraphSolver(topology, problem, {
      RIP_THRESHOLD_RAMP_ATTEMPTS: 2,
      GREEDY_FINAL_ROUTE_ITERS: 0,
    })
  }
  const runtime = new SolverRuntime()
  try {
    const serial = create()
    const parallel = create()
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(parallel.solved).toBe(true)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(JSON.stringify(parallel.getOutput())).toBe(
      JSON.stringify(serial.getOutput()),
    )
    expect(parallel.asyncStats.dispatchedRoutes).toBeGreaterThan(16)
    expect(parallel.asyncStats.conflictedRoutes).toBeGreaterThan(0)
  } finally {
    await runtime.dispose()
  }
})
