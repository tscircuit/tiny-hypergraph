import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { TinyHyperGraphSectionOptimizationPipelineSolver } from "lib/section-optimization-pipeline"
import { TinyHyperGraphSectionSolver } from "lib/section-solver"

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxCost, regionCache) => Math.max(maxCost, regionCache.existingRegionCost),
    0,
  )

test("section solver improves sample003 without a serialized graph roundtrip", () => {
  const serializedHyperGraph = datasetHg07.sample003 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const initialSolver = new TinyHyperGraphSolver(topology, problem)

  initialSolver.solve()

  expect(initialSolver.solved).toBe(true)
  expect(initialSolver.failed).toBe(false)

  const initialMaxRegionCost = getMaxRegionCost(initialSolver)
  problem.shuffleSeed = 7
  const sectionSolver = new TinyHyperGraphSectionSolver({
    topology,
    problem,
    solution: initialSolver.getSolution(),
    regionCosts: Float64Array.from(
      initialSolver.state.regionIntersectionCaches.map(
        (regionCache) => regionCache.existingRegionCost,
      ),
    ),
    options: {
      attemptsPerSection: 3,
      maxSectionsToTry: 20,
    },
  })

  sectionSolver.solve()

  expect(sectionSolver.solved).toBe(true)
  expect(sectionSolver.failed).toBe(false)

  const optimizedMaxRegionCost = sectionSolver.getCurrentMaxRegionCost()

  expect(optimizedMaxRegionCost).toBeLessThan(initialMaxRegionCost)
})

test("section optimization pipeline reuses topology/problem and never serializes the middle stage", () => {
  const serializedHyperGraph = datasetHg07.sample004 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const pipeline = new TinyHyperGraphSectionOptimizationPipelineSolver({
    topology,
    problem,
    sectionSolverOptions: {
      attemptsPerSection: 3,
      maxSectionsToTry: 20,
    },
  })

  pipeline.solve()

  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)

  const initialSolver = pipeline.getInitialSolveSolver()
  const sectionSolver = pipeline.getSectionOptimizationSolver()
  const optimizedState = pipeline.getOutput()

  expect(initialSolver).toBeDefined()
  expect(sectionSolver).toBeDefined()
  expect(sectionSolver?.input.topology).toBe(topology)
  expect(sectionSolver?.input.problem).toBe(problem)
  expect(pipeline.getStageOutput("initialSolver")).toBeUndefined()

  const initialMaxRegionCost = getMaxRegionCost(initialSolver!)
  const optimizedMaxRegionCost = sectionSolver!.getCurrentMaxRegionCost()

  expect(optimizedMaxRegionCost).toBeLessThanOrEqual(initialMaxRegionCost)
  expect(optimizedState?.topology).toBe(topology)
  expect(optimizedState?.problem).toBe(problem)
})
