import { expect, test } from "bun:test"
import { FixedRoundTinyHyperGraphSolver } from "../../lib/parallel"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { gridGraph } from "../fixtures/parallel-grid-graph"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

async function run(graph: SerializedHyperGraph, workers: number, options = {}) {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new FixedRoundTinyHyperGraphSolver(topology, problem, {
    workers,
    ...options,
  })
  await solver.solveAsync()
  // Check hard ownership and single-layer crossing invariants, including failed states.
  for (let r = 0; r < topology.regionCount; r++) {
    if (solver.isKnownSingleLayerRegion(r))
      expect(
        solver.state.regionIntersectionCaches[r].existingSameLayerIntersections,
      ).toBe(0)
    for (const [route, a, b] of solver.state.regionSegments[r]) {
      expect(solver.state.portAssignment[a]).toBe(problem.routeNet[route])
      expect(solver.state.portAssignment[b]).toBe(problem.routeNet[route])
    }
  }
  const value = {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    stats: solver.stats,
    roundStats: solver.roundStats,
    segments: solver.state.regionSegments,
    portPrices: Array.from(solver.problem.portPenalty!),
    output: solver.solved && !solver.failed ? solver.getOutput() : null,
  }
  return { solver, value }
}
test("unchanged bounded searches are reused without changing logical retries", async () => {
  const options = { ROUTE_STEP_LIMIT: 1, MAX_ITERATIONS: 100 }
  const baseline = await run(gridGraph(5), 1, options)
  const parallel = await run(gridGraph(5), 8, options)
  expect(parallel.value).toEqual(baseline.value)
  expect(parallel.solver.executionStats).toEqual(baseline.solver.executionStats)
  expect(baseline.solver.executionStats.unchangedSnapshotHits).toBeGreaterThan(
    0,
  )
}, 30000)
test("fixed snapshots and conflict decisions are identical with 1/2/4/8 workers", async () => {
  const graph = gridGraph(5)
  const options = {
    ROUND_SIZE: 8,
    RIP_THRESHOLD_START: 0,
    RIP_THRESHOLD_END: 0,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
    MAX_ITERATIONS: 10000,
  }
  const baseline = await run(graph, 1, options)
  for (const workers of [2, 4, 8])
    expect((await run(graph, workers, options)).value).toEqual(baseline.value)
  expect(baseline.solver.roundStats.rounds).toBeGreaterThan(1)
}, 30000)
test("parallel proposals never claim ports owned by a different net", async () => {
  const graph = gridGraph(5)
  const baseline = await run(graph, 1, {
    ROUND_SIZE: 32,
    MAX_ITERATIONS: 20000,
  })
  expect(baseline.solver.roundStats.portConflicts).toBeGreaterThan(0)
  expect(
    (await run(graph, 8, { ROUND_SIZE: 32, MAX_ITERATIONS: 20000 })).value,
  ).toEqual(baseline.value)
}, 30000)
test("single-layer crossings are rejected consistently", async () => {
  const graph = gridGraph(4)
  for (const region of graph.regions) region.d.availableZ = [0]
  const baseline = await run(graph, 1, { ROUND_SIZE: 8, MAX_ITERATIONS: 5000 })
  for (const workers of [2, 8])
    expect(
      (await run(graph, workers, { ROUND_SIZE: 8, MAX_ITERATIONS: 5000 }))
        .value,
    ).toEqual(baseline.value)
}, 30000)
test("small search budgets, empty and preloaded inputs stay deterministic", async () => {
  for (const max of [1, 2, 9, 40, 120]) {
    const baseline = await run(gridGraph(3), 1, { MAX_ITERATIONS: max })
    expect((await run(gridGraph(3), 4, { MAX_ITERATIONS: max })).value).toEqual(
      baseline.value,
    )
    expect(baseline.solver.iterations).toBeLessThanOrEqual(max)
  }
  const empty = gridGraph(2)
  empty.connections = []
  expect((await run(empty, 8)).value).toEqual((await run(empty, 1)).value)
  const { solver } = await run(gridGraph(2), 1)
  expect(solver.solved).toBe(true)
  const preloaded = solver.getOutput()
  expect((await run(preloaded, 4)).value).toEqual(
    (await run(preloaded, 1)).value,
  )
}, 30000)
test("unsupported invocation and concurrent execution fail clearly", async () => {
  const { topology, problem } = loadSerializedHyperGraph(gridGraph(3))
  const solver = new FixedRoundTinyHyperGraphSolver(topology, problem, {
    workers: 2,
  })
  expect(() => solver.solve()).toThrow("solveAsync")
  const pending = solver.solveAsync()
  await expect(solver.solveAsync()).rejects.toThrow("already running")
  await pending
  expect(
    () =>
      new FixedRoundTinyHyperGraphSolver(topology, problem, { ROUND_SIZE: 0 }),
  ).toThrow("positive integer")
  expect(
    () =>
      new FixedRoundTinyHyperGraphSolver(topology, problem, {
        MAX_ITERATIONS: 0,
      }),
  ).toThrow("positive integer")
  expect(
    () =>
      new FixedRoundTinyHyperGraphSolver(topology, problem, {
        OWNED_REGIONAL_HOP_FRONTIER: true,
      }),
  ).toThrow("OWNED_REGIONAL")
}, 30000)
test("hard feasibility does not treat an infinite goal penalty as a crossing", async () => {
  const graph = gridGraph(2)
  graph.connections = [graph.connections![0]]
  for (const region of graph.regions) region.d.availableZ = [0]
  let expected = ""
  for (const workers of [1, 4]) {
    const { topology, problem } = loadSerializedHyperGraph(graph)
    problem.portPenalty = new Float64Array(topology.portCount)
    for (const port of problem.routeEndPort)
      problem.portPenalty[port] = Infinity
    const solver = new FixedRoundTinyHyperGraphSolver(topology, problem, {
      workers,
      ROUND_SIZE: 2,
    })
    await solver.solveAsync()
    expect(solver.solved).toBe(true)
    const fingerprint = JSON.stringify({
      output: solver.getOutput(),
      stats: solver.stats,
      round: solver.roundStats,
    })
    if (expected) expect(fingerprint).toBe(expected)
    expected = fingerprint
  }
}, 30000)
test("negotiated prices are persistent, deterministic and do not mutate caller arrays", async () => {
  const graph = gridGraph(5)
  let expected = ""
  for (const workers of [1, 8]) {
    const { topology, problem } = loadSerializedHyperGraph(graph)
    problem.portPenalty = new Float64Array(topology.portCount).fill(0.3)
    const original = problem.portPenalty.slice()
    const solver = new FixedRoundTinyHyperGraphSolver(topology, problem, {
      workers,
      MAX_ITERATIONS: 20000,
      PORT_CONFLICT_PENALTY: 1,
    })
    await solver.solveAsync()
    expect(problem.portPenalty).toEqual(original)
    expect(solver.roundStats.portConflicts).toBeGreaterThan(0)
    expect(solver.problem.portPenalty!.some((n) => n > 0.3)).toBe(true)
    const value = JSON.stringify({
      prices: Array.from(solver.problem.portPenalty!),
      stats: solver.roundStats,
      segments: solver.state.regionSegments,
    })
    if (expected) expect(value).toBe(expected)
    expected = value
  }
}, 30000)
test("legacy greedy completion cannot bypass the fixed-round hard constraints", () => {
  const { topology, problem } = loadSerializedHyperGraph(gridGraph(2))
  expect(
    () =>
      new FixedRoundTinyHyperGraphSolver(topology, problem, {
        GREEDY_FINAL_ROUTE_ITERS: 4,
      }),
  ).toThrow("GREEDY_FINAL_ROUTE_ITERS=0")
})
