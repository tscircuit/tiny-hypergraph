import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  TinyHyperGraphUnravelSolver,
} from "lib/index"
import { sectionSolverFixtureGraph } from "tests/fixtures/section-solver.fixture"

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getSerializedOutputMaxRegionCost = (
  output: ReturnType<TinyHyperGraphUnravelSolver["getOutput"]>,
) => {
  const replay = loadSerializedHyperGraph(output)
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  return getMaxRegionCost(replayedSolver.baselineSolver)
}

test("unravel solver improves the crossing fixture with a mutation path", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  const unravelSolver = new TinyHyperGraphUnravelSolver(
    topology,
    problem,
    solution,
    {
      MAX_MUTATION_DEPTH: 2,
      MAX_SEARCH_STATES: 6,
      MAX_ENQUEUED_MUTATIONS_PER_STATE: 2,
    },
  )

  unravelSolver.solve()

  expect(unravelSolver.solved).toBe(true)
  expect(unravelSolver.failed).toBe(false)
  expect(unravelSolver.stats.optimized).toBe(true)
  expect(Number(unravelSolver.stats.mutationDepth)).toBeGreaterThan(0)
  expect(getMaxRegionCost(unravelSolver.getSolvedSolver())).toBeLessThan(
    getMaxRegionCost(unravelSolver.baselineSolver),
  )
  expect(getSerializedOutputMaxRegionCost(unravelSolver.getOutput())).toBeCloseTo(
    getMaxRegionCost(unravelSolver.getSolvedSolver()),
    10,
  )
})

test("unravel solver improves hg07 sample002 after the baseline solveGraph pass", () => {
  const { topology, problem } = loadSerializedHyperGraph(datasetHg07.sample002)
  const solveGraphSolver = new TinyHyperGraphSolver(topology, problem)
  solveGraphSolver.solve()

  const replay = loadSerializedHyperGraph(solveGraphSolver.getOutput())
  const unravelSolver = new TinyHyperGraphUnravelSolver(
    replay.topology,
    replay.problem,
    replay.solution,
    {
      MAX_MUTATION_DEPTH: 1,
      MAX_SEARCH_STATES: 2,
      MAX_ENQUEUED_MUTATIONS_PER_STATE: 1,
    },
  )

  unravelSolver.solve()

  expect(unravelSolver.solved).toBe(true)
  expect(unravelSolver.failed).toBe(false)
  expect(unravelSolver.stats.optimized).toBe(true)
  expect(getMaxRegionCost(unravelSolver.getSolvedSolver())).toBeLessThan(
    getMaxRegionCost(unravelSolver.baselineSolver),
  )
})

test("unravel stage beats the optimizeSection stage on hg07 sample004", () => {
  const { topology, problem } = loadSerializedHyperGraph(datasetHg07.sample004)
  const solveGraphSolver = new TinyHyperGraphSolver(topology, problem)
  solveGraphSolver.solve()

  const sectionPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample004,
  })
  sectionPipelineSolver.solve()

  const replay = loadSerializedHyperGraph(solveGraphSolver.getOutput())
  const unravelSolver = new TinyHyperGraphUnravelSolver(
    replay.topology,
    replay.problem,
    replay.solution,
    {
      MAX_MUTATION_DEPTH: 2,
      MAX_SEARCH_STATES: 8,
      MAX_ENQUEUED_MUTATIONS_PER_STATE: 2,
    },
  )

  unravelSolver.solve()

  expect(sectionPipelineSolver.solved).toBe(true)
  expect(sectionPipelineSolver.failed).toBe(false)
  expect(unravelSolver.solved).toBe(true)
  expect(unravelSolver.failed).toBe(false)
  expect(
    sectionPipelineSolver.getStageOutput("optimizeSection"),
  ).toBeDefined()
  expect(getSerializedOutputMaxRegionCost(unravelSolver.getOutput())).toBeLessThan(
    getSerializedOutputMaxRegionCost(
      sectionPipelineSolver.getStageOutput("optimizeSection")!,
    ),
  )
})
