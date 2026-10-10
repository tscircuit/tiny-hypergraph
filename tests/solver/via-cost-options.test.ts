import { expect, test } from "bun:test"
import {
  applyTinyHyperGraphSolverOptions,
  getTinyHyperGraphSolverOptions,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { TinyHyperGraphSectionSolver } from "lib/section-solver"

test("via policy options propagate through section solvers and cached candidate costs", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3], []],
    incidentPortRegion: [
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ],
    regionWidth: Float64Array.of(3, 1),
    regionHeight: Float64Array.of(3, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 0),
    portAngleForRegion1: Int32Array.of(0, 9000, 18000, 27000),
    portX: Float64Array.of(1, 0, -1, 0),
    portY: Float64Array.of(0, 1, 0, -1),
    portZ: Int32Array.of(0, 1, 0, 1),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: Int32Array.of(0, 1),
    routeEndPort: Int32Array.of(2, 3),
    routeNet: Int32Array.of(0, 1),
    regionNetId: new Int32Array(2).fill(-1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)
  expect(solver.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(1)
  expect(solver.VIA_COST).toBe(0)
  applyTinyHyperGraphSolverOptions(solver, {
    CROSS_LAYER_INTERSECTION_COST_FACTOR: 0,
    VIA_COST: 0.3,
  })
  const options = getTinyHyperGraphSolverOptions(solver)
  expect(options.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(0)
  expect(options.VIA_COST).toBe(0.3)

  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(0, 0, 2)
  solver.state.currentRouteNetId = 1
  expect(
    solver.computeG({ nextRegionId: 0, portId: 1, f: 0, g: 0, h: 0 }, 3),
  ).toBe(0)
  solver.appendSegmentToRegionCache(0, 1, 3)
  expect(solver.state.regionIntersectionCaches[0].existingRegionCost).toBe(0)

  const section = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    {
      solvedRoutePathSegments: [[[0, 2]], [[1, 3]]],
      solvedRoutePathRegionIds: [[0], [0]],
    },
    options,
  )
  expect(section.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(0)
  expect(section.VIA_COST).toBe(0.3)
  expect(section.baselineSolver.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(0)
  expect(section.baselineSolver.VIA_COST).toBe(0.3)
  expect(section.baselineSummary.totalRegionCost).toBe(0)

  const transition = new TinyHyperGraphSolver(topology, problem, options)
  transition.state.currentRouteNetId = 0
  expect(
    transition.computeG({ nextRegionId: 0, portId: 0, f: 0, g: 0, h: 0 }, 1),
  ).toBeCloseTo(0.327)
  transition.appendSegmentToRegionCache(0, 0, 1)
  expect(
    transition.state.regionIntersectionCaches[0].existingRegionCost,
  ).toBeCloseTo(0.327)
})
