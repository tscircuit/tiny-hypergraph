import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphMultiSectionUnravelSolver,
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

test("unravel solver evaluates one mutation candidate per step on hg07 sample002 after section optimization", () => {
  const sectionPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
  })

  sectionPipelineSolver.solveUntilStage("unravel")

  const optimizedOutput =
    sectionPipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
      "optimizeSection",
    )

  expect(optimizedOutput).toBeDefined()

  const replay = loadSerializedHyperGraph(optimizedOutput!)
  const unravelSolver = new TinyHyperGraphUnravelSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  unravelSolver.step()
  const initialPendingMutationCount = Number(
    unravelSolver.stats.pendingMutationCount,
  )

  expect(unravelSolver.stats.searchPhase).toBe("prepared-state")
  expect(initialPendingMutationCount).toBeGreaterThan(0)
  expect(Number(unravelSolver.stats.attemptedCandidateCount)).toBe(0)

  unravelSolver.step()

  expect(unravelSolver.stats.searchPhase).toBe("evaluating-mutation")
  expect(Number(unravelSolver.stats.attemptedCandidateCount)).toBe(1)
  expect(Number(unravelSolver.stats.pendingMutationCount)).toBe(
    initialPendingMutationCount - 1,
  )

  unravelSolver.step()

  expect(Number(unravelSolver.stats.attemptedCandidateCount)).toBe(2)
  expect(Number(unravelSolver.stats.pendingMutationCount)).toBe(
    initialPendingMutationCount - 2,
  )
})

test("unravel solver keeps exploring sample002 after non-improving first-hop mutations", () => {
  const sectionPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
  })

  sectionPipelineSolver.solveUntilStage("unravel")

  const optimizedOutput =
    sectionPipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
      "optimizeSection",
    )

  expect(optimizedOutput).toBeDefined()

  const replay = loadSerializedHyperGraph(optimizedOutput!)
  const unravelSolver = new TinyHyperGraphUnravelSolver(
    replay.topology,
    replay.problem,
    replay.solution,
    {
      MAX_MUTATION_DEPTH: 2,
      MAX_SEARCH_STATES: 6,
      MAX_ENQUEUED_MUTATIONS_PER_STATE: 2,
    },
  )

  unravelSolver.solve()

  expect(unravelSolver.solved).toBe(true)
  expect(unravelSolver.failed).toBe(false)
  expect(Number(unravelSolver.stats.searchStatesExpanded)).toBeGreaterThan(1)
  expect(Number(unravelSolver.stats.attemptedCandidateCount)).toBeGreaterThan(3)
  expect(unravelSolver.iterations).toBeGreaterThan(6)
})

test("multi-section unravel solver re-seeds multiple hot sections on hg07 sample002", () => {
  const sectionPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
  })

  sectionPipelineSolver.solveUntilStage("unravel")

  const optimizedOutput =
    sectionPipelineSolver.getStageOutput<ReturnType<TinyHyperGraphSectionSolver["getOutput"]>>(
      "optimizeSection",
    )

  expect(optimizedOutput).toBeDefined()

  const replay = loadSerializedHyperGraph(optimizedOutput!)
  const unravelSolver = new TinyHyperGraphMultiSectionUnravelSolver(
    replay.topology,
    replay.problem,
    replay.solution,
    {
      MAX_SECTIONS: 4,
      MAX_SECTION_ATTEMPTS_PER_ROOT_REGION: 1,
    },
  )

  unravelSolver.solve()

  expect(unravelSolver.solved).toBe(true)
  expect(unravelSolver.failed).toBe(false)
  expect(Number(unravelSolver.stats.sectionsCompleted)).toBeGreaterThan(1)
  expect(
    Array.isArray(unravelSolver.stats.attemptedRootRegionIds)
      ? new Set(unravelSolver.stats.attemptedRootRegionIds as number[]).size
      : 0,
  ).toBeGreaterThan(1)
})
