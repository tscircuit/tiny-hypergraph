import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSolver,
} from "lib/index"
import { createSample002SectionPortMask } from "tests/fixtures/sample002-section.fixture"

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

test("section solver improves the max region cost on hg07 sample002", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    datasetHg07.sample002,
  )
  problem.portSectionMask = createSample002SectionPortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
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

test("section solver getOutput preserves the optimized max region cost on hg07 sample002", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    datasetHg07.sample002,
  )
  problem.portSectionMask = createSample002SectionPortMask(topology)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)
  expect(sectionSolver.stats.optimized).toBe(true)

  const optimizedMaxRegionCost = getMaxRegionCost(sectionSolver.getSolvedSolver())
  const replay = loadSerializedHyperGraph(sectionSolver.getOutput())
  const replayedSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  expect(getMaxRegionCost(replayedSolver.baselineSolver)).toBeCloseTo(
    optimizedMaxRegionCost,
    10,
  )
})

test("sample002 automatic section search keeps the same winner in serial and parallel candidate evaluation", () => {
  const serialPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
    sectionSearchConfig: {
      maxParallelCandidates: 1,
    },
  })
  const parallelPipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: datasetHg07.sample002,
    sectionSearchConfig: {
      maxParallelCandidates: 2,
    },
  })

  serialPipelineSolver.solve()
  parallelPipelineSolver.solve()

  expect(serialPipelineSolver.solved).toBe(true)
  expect(parallelPipelineSolver.solved).toBe(true)
  expect(serialPipelineSolver.failed).toBe(false)
  expect(parallelPipelineSolver.failed).toBe(false)
  expect(serialPipelineSolver.selectedSectionCandidateLabel).toBe(
    parallelPipelineSolver.selectedSectionCandidateLabel,
  )
  expect(serialPipelineSolver.selectedSectionCandidateFamily).toBe(
    parallelPipelineSolver.selectedSectionCandidateFamily,
  )
  expect(serialPipelineSolver.stats.sectionSearchFinalMaxRegionCost).toBe(
    parallelPipelineSolver.stats.sectionSearchFinalMaxRegionCost,
  )
})
