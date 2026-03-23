import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "lib/index"
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

test("section subproblem reroutes repeated entries into the same section as one slice", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1, 4, 5],
      [1, 2, 3, 4],
    ],
    incidentPortRegion: [[0], [0, 1], [1], [1], [0, 1], [0]],
    regionWidth: new Float64Array([1, 1]),
    regionHeight: new Float64Array([1, 1]),
    regionCenterX: new Float64Array([0, 1]),
    regionCenterY: new Float64Array([0, 0]),
    portAngleForRegion1: new Int32Array([0, 0, 0, 0, 0, 0]),
    portAngleForRegion2: new Int32Array([0, 0, 0, 0, 0, 0]),
    portX: new Float64Array([0, 0, 1, 1, 2, 2]),
    portY: new Float64Array([0, 1, 0, 1, 0, 1]),
    portZ: new Int32Array([0, 0, 0, 0, 0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1, 1, 1, 1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([5]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
    congestionAvgWindowSize: 7,
    congestionWeight: 1.5,
    congestionFalloff: 0.6,
    initialRegionCongestionCost: new Float64Array([0.2, 0.4]),
  }
  const solution: TinyHyperGraphSolution = {
    solvedRoutePathSegments: [
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ],
    ],
    solvedRouteRegionIds: [[0, 1, 0]],
  }

  const solver = new TinyHyperGraphSectionSolver({
    topology,
    problem,
    solution,
    regionCosts: new Float64Array([0.25, 0.1]),
    options: {
      expansionDegrees: 0,
    },
  })

  const { routeSlices, sectionProblem } = solver.buildSectionSubProblem([0])

  expect(routeSlices).toHaveLength(1)
  expect(routeSlices[0]).toMatchObject({
    originalRouteId: 0,
    startSegmentIndex: 0,
    endSegmentIndex: 2,
    startPortId: 0,
    endPortId: 5,
  })
  expect(sectionProblem.routeCount).toBe(1)
  expect(sectionProblem.routeStartPort[0]).toBe(0)
  expect(sectionProblem.routeEndPort[0]).toBe(5)
  expect(sectionProblem.congestionAvgWindowSize).toBe(7)
  expect(sectionProblem.congestionWeight).toBe(1.5)
  expect(sectionProblem.congestionFalloff).toBe(0.6)
  expect(Array.from(sectionProblem.initialRegionCongestionCost ?? [])).toEqual([
    0.2, 0.4,
  ])
})
