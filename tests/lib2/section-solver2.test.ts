import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib2/graph-load"
import {
  TinyHyperGraphSectionSolver2,
  type TinyHyperGraphSolver2,
} from "lib2/index"
import { createSample002SectionPortMask } from "tests/fixtures/sample002-section.fixture"
import {
  createSectionSolverFixturePortMask,
  sectionSolverFixtureGraph,
} from "tests/fixtures/section-solver.fixture"

const getMaxRegionCost = (solver: TinyHyperGraphSolver2) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

test("section solver 2 improves the max region cost on hg07 sample002", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    datasetHg07.sample002,
  )
  problem.portSectionMask = createSample002SectionPortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver2(
    topology,
    problem,
    solution,
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.activeRouteIds.length).toBeGreaterThan(0)
  expect(sectionSolver.stats.optimized).toBe(true)

  const initialMaxRegionCost = getMaxRegionCost(sectionSolver.baselineSolver)
  const finalMaxRegionCost = getMaxRegionCost(sectionSolver.getSolvedSolver())

  expect(finalMaxRegionCost).toBeLessThan(initialMaxRegionCost)
  expect(initialMaxRegionCost - finalMaxRegionCost).toBeGreaterThan(0.5)
})

test("section solver 2 output preserves optimized max region cost", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    datasetHg07.sample002,
  )
  problem.portSectionMask = createSample002SectionPortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver2(
    topology,
    problem,
    solution,
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.stats.optimized).toBe(true)

  const optimizedMaxRegionCost = getMaxRegionCost(
    sectionSolver.getSolvedSolver(),
  )
  const replay = loadSerializedHyperGraph(sectionSolver.getOutput())
  const replayedSolver = new TinyHyperGraphSectionSolver2(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  expect(getMaxRegionCost(replayedSolver.baselineSolver)).toBeCloseTo(
    optimizedMaxRegionCost,
    10,
  )
})

test("section solver 2 rejects incomplete timeout candidates", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    sectionSolverFixtureGraph,
  )
  problem.portSectionMask = createSectionSolverFixturePortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver2(
    topology,
    problem,
    solution,
    {
      MAX_ITERATIONS: 1,
    },
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.getSolvedSolver()).toBe(sectionSolver.baselineSolver)
  expect(sectionSolver.stats.sectionSearchFailedFallbackToBaseline).toBe(true)
  expect(
    sectionSolver.stats.rejectedIncompleteSectionStateOnTimeout,
  ).toBe(true)
})
