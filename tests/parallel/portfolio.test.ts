import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { solveTinyHyperGraphPortfolio } from "../../lib/parallel"
import { CachedPortfolioSolver } from "../../lib/parallel/CachedPortfolioSolver"
import { CachedDistancePortfolioSolver } from "../../lib/parallel/CachedDistancePortfolioSolver"
import { DistanceAwareTinyHyperGraphSolver } from "../../lib/distance-aware-tiny-hypergraph-solver"
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
