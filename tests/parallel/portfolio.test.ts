import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import {
  solveTinyHyperGraphPortfolio,
  TinyHyperGraphPortfolioPool,
} from "../../lib/parallel"
import {
  createSharedRouteDistances,
  createSharedRouteHeuristics,
} from "../../lib/parallel/shared-distances"
import { CachedPortfolioSolver } from "../../lib/parallel/CachedPortfolioSolver"
import { CachedDistancePortfolioSolver } from "../../lib/parallel/CachedDistancePortfolioSolver"
import { DistanceAwareTinyHyperGraphSolver } from "../../lib/distance-aware-tiny-hypergraph-solver"
import { NativeDistancePortfolioSolver } from "../../lib/parallel/NativeDistancePortfolioSolver"
import { NativePortfolioSolver } from "../../lib/parallel/NativePortfolioSolver"
import { comparePortfolioCandidates } from "../../lib/parallel/portfolio-candidate"
import { shuffle } from "../../lib/shuffle"
import { gridGraph } from "../fixtures/parallel-grid-graph"

test("eight candidates, selected output and diagnostics are invariant across core counts", async () => {
  const graph = gridGraph(5)
  const solverOptions = { MAX_ITERATIONS: 5000 }
  const baseline = await solveTinyHyperGraphPortfolio(graph, {
    workers: 1,
    solverOptions,
  })
  expect(baseline.candidates).toHaveLength(8)
  expect(baseline.selectedCandidate).toBe(
    [...baseline.candidates].sort(comparePortfolioCandidates)[0].index,
  )
  for (const workers of [2, 4, 8])
    expect(
      await solveTinyHyperGraphPortfolio(graph, { workers, solverOptions }),
    ).toEqual(baseline)
}, 30000)

test("cached distance candidates preserve indexed frontier and terminal scoring", () => {
  const { topology, problem } = loadSerializedHyperGraph(gridGraph(5))
  for (const options of [
    { MAX_ITERATIONS: 5000, GREEDY_FINAL_ROUTE_ITERS: 0 },
    {
      MAX_ITERATIONS: 500,
      OWNED_REGIONAL_HOP_FRONTIER: true,
      GREEDY_FINAL_ROUTE_ITERS: 0,
    },
    {
      MAX_ITERATIONS: 500,
      USE_SPARSE_CANDIDATE_STORAGE: true,
      GREEDY_FINAL_ROUTE_ITERS: 0,
    },
  ])
    for (let seed = 0; seed < 8; seed++) {
      const plain = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      const cached = new CachedDistancePortfolioSolver(
        topology,
        problem,
        options,
        createSharedRouteDistances(topology),
        createSharedRouteHeuristics(topology, problem),
      )
      for (const solver of [plain, cached]) {
        solver.state.unroutedRoutes = shuffle(solver.state.unroutedRoutes, seed)
        solver.solve()
      }
      expect({
        solved: cached.solved,
        failed: cached.failed,
        error: cached.error,
        iterations: cached.iterations,
        stats: cached.stats,
        segments: cached.state.regionSegments,
      }).toEqual({
        solved: plain.solved,
        failed: plain.failed,
        error: plain.error,
        iterations: plain.iterations,
        stats: plain.stats,
        segments: plain.state.regionSegments,
      })
    }
})

test("native searches match distance-aware paths, rerips and exact step budgets", () => {
  const ordinary = gridGraph(5)
  const single = gridGraph(4)
  for (const region of single.regions) region.d.availableZ = [31]
  for (const port of single.ports) port.d.z = 31
  for (const graph of [ordinary, single]) {
    const { topology, problem } = loadSerializedHyperGraph(graph)
    for (const options of [
      { MAX_ITERATIONS: 1, GREEDY_FINAL_ROUTE_ITERS: 0 },
      { MAX_ITERATIONS: 9, GREEDY_FINAL_ROUTE_ITERS: 0 },
      { MAX_ITERATIONS: 1000, GREEDY_FINAL_ROUTE_ITERS: 0 },
      {
        MAX_ITERATIONS: 5000,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        RIP_THRESHOLD_START: 0,
        RIP_THRESHOLD_END: 0,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
      },
      {
        MAX_ITERATIONS: 5000,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        TRACE_DENSITY_COST_FACTOR: 1,
      },
      {
        MAX_ITERATIONS: 5000,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        USE_SPARSE_CANDIDATE_STORAGE: true,
        OWNED_REGIONAL_HOP_FRONTIER: true,
      },
    ])
      for (let seed = 0; seed < 8; seed++) {
        const plain = new DistanceAwareTinyHyperGraphSolver(
          topology,
          problem,
          options,
        )
        const native = new NativeDistancePortfolioSolver(
          topology,
          problem,
          options,
        )
        for (const solver of [plain, native]) {
          solver.state.unroutedRoutes = shuffle(
            solver.state.unroutedRoutes,
            seed,
          )
          solver.solve()
        }
        const value = (solver: DistanceAwareTinyHyperGraphSolver) => ({
          solved: solver.solved,
          failed: solver.failed,
          error: solver.error,
          iterations: solver.iterations,
          stats: solver.stats,
          ports: solver.state.portAssignment,
          segments: solver.state.regionSegments,
          output: solver.solved && !solver.failed ? solver.getOutput() : null,
        })
        expect(value(native)).toEqual(value(plain))
      }
  }
})

test("native legacy history preserves reopened and stale candidates", () => {
  const { topology, problem } = loadSerializedHyperGraph(gridGraph(5))
  for (const options of [
    { MAX_ITERATIONS: 1 },
    { MAX_ITERATIONS: 9 },
    { MAX_ITERATIONS: 1000 },
    {
      MAX_ITERATIONS: 5000,
      RIP_THRESHOLD_START: 0,
      RIP_THRESHOLD_END: 0,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
    },
    { MAX_ITERATIONS: 5000, TRACE_DENSITY_COST_FACTOR: 1 },
    { MAX_ITERATIONS: 5000, USE_SPARSE_CANDIDATE_STORAGE: true },
  ])
    for (let seed = 0; seed < 8; seed++) {
      const plain = new TinyHyperGraphSolver(topology, problem, options)
      const native = new NativePortfolioSolver(topology, problem, options)
      for (const solver of [plain, native]) {
        solver.state.unroutedRoutes = shuffle(solver.state.unroutedRoutes, seed)
        solver.solve()
      }
      const value = (solver: TinyHyperGraphSolver) => ({
        solved: solver.solved,
        failed: solver.failed,
        error: solver.error,
        iterations: solver.iterations,
        stats: solver.stats,
        ports: solver.state.portAssignment,
        segments: solver.state.regionSegments,
        output: solver.solved && !solver.failed ? solver.getOutput() : null,
      })
      expect(value(native)).toEqual(value(plain))
    }
})

test("persistent workers retain per-graph outcomes and reject overlapping calls", async () => {
  const pool = new TinyHyperGraphPortfolioPool({ workers: 8 })
  const options = { MAX_ITERATIONS: 5000 }
  try {
    for (const n of [3, 5, 3]) {
      const graph = gridGraph(n)
      expect(await pool.solve(graph, options)).toEqual(
        await solveTinyHyperGraphPortfolio(graph, {
          workers: 1,
          solverOptions: options,
        }),
      )
    }
    const pending = pool.solve(gridGraph(5), options)
    await expect(pool.solve(gridGraph(3), options)).rejects.toThrow(
      "already running",
    )
    await expect(pool.close()).rejects.toThrow("while it is running")
    await pending
  } finally {
    await pool.close()
  }
  await expect(pool.solve(gridGraph(2))).rejects.toThrow("closed")
  await pool.close()
}, 30000)

test("cached complete candidates match legacy search, rerips and timeout acceptance", () => {
  const graph = gridGraph(5)
  for (const options of [
    {
      MAX_ITERATIONS: 5000,
      RIP_THRESHOLD_START: 0,
      RIP_THRESHOLD_END: 0,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
    },
    { MAX_ITERATIONS: 5 },
    { MAX_ITERATIONS: 500, USE_SPARSE_CANDIDATE_STORAGE: true },
    { MAX_ITERATIONS: 500, TRACE_DENSITY_COST_FACTOR: 1 },
    { MAX_ITERATIONS: 500, OWNED_REGIONAL_HOP_FRONTIER: true },
  ])
    for (let seed = 0; seed < 8; seed++) {
      const { topology, problem } = loadSerializedHyperGraph(graph)
      const plain = new TinyHyperGraphSolver(topology, problem, options)
      const cached = new CachedPortfolioSolver(topology, problem, options)
      for (const solver of [plain, cached]) {
        if (seed)
          solver.state.unroutedRoutes = shuffle(
            solver.state.unroutedRoutes,
            seed,
          )
        solver.solve()
      }
      const state = (s: TinyHyperGraphSolver) => ({
        solved: s.solved,
        failed: s.failed,
        error: s.error,
        iterations: s.iterations,
        stats: s.stats,
        assignments: s.state.portAssignment,
        segments: s.state.regionSegments,
        output: s.solved && !s.failed ? s.getOutput() : null,
      })
      expect(state(cached)).toEqual(state(plain))
    }
})

test("empty, preloaded, invalid budget and failed portfolio inputs", async () => {
  const empty = gridGraph(2)
  empty.connections = []
  expect(await solveTinyHyperGraphPortfolio(empty, { workers: 8 })).toEqual(
    await solveTinyHyperGraphPortfolio(empty, { workers: 1 }),
  )
  const solved = await solveTinyHyperGraphPortfolio(gridGraph(2), {
    workers: 1,
  })
  expect(solved.solved).toBe(true)
  expect(
    await solveTinyHyperGraphPortfolio(solved.output!, { workers: 4 }),
  ).toEqual(await solveTinyHyperGraphPortfolio(solved.output!, { workers: 1 }))
  const failedOptions = { MAX_ITERATIONS: 1, GREEDY_FINAL_ROUTE_ITERS: 0 }
  const failed = await solveTinyHyperGraphPortfolio(gridGraph(5), {
    workers: 1,
    solverOptions: failedOptions,
  })
  expect(failed.failed).toBe(true)
  expect(
    await solveTinyHyperGraphPortfolio(gridGraph(5), {
      workers: 8,
      solverOptions: failedOptions,
    }),
  ).toEqual(failed)
  await expect(
    solveTinyHyperGraphPortfolio(empty, { workers: 0 }),
  ).rejects.toThrow("positive integer")
  await expect(
    solveTinyHyperGraphPortfolio(empty, {
      solverOptions: { MAX_ITERATIONS: 0 },
    }),
  ).rejects.toThrow("positive integer")
}, 30000)
