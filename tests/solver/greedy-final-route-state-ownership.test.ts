import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "lib/index"

class ObservableGreedyFinalRouteSolver extends TinyHyperGraphSolver {
  completedGreedySolver?: TinyHyperGraphSolver

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    const solver = super.createGreedyFinalRouteSolver(options, attempt)
    this.completedGreedySolver = solver
    return solver
  }
}

test("greedy final routing adopts the completed child state", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 3,
    regionIncidentPorts: [[0], [0, 1], [1]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
    ],
    regionWidth: new Float64Array(3).fill(1),
    regionHeight: new Float64Array(3).fill(1),
    regionCenterX: new Float64Array(3),
    regionCenterY: new Float64Array(3),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(3).fill(-1),
  }
  const solver = new ObservableGreedyFinalRouteSolver(topology, problem, {
    GREEDY_FINAL_ROUTE_ITERS: 1,
  })

  solver.tryFinalAcceptance()

  const completedGreedySolver = solver.completedGreedySolver
  expect(completedGreedySolver).toBeDefined()
  expect(solver.solved).toBe(true)
  expect(solver.state.portAssignment).toBe(
    completedGreedySolver!.state.portAssignment,
  )
  expect(solver.state.regionSegments).toBe(
    completedGreedySolver!.state.regionSegments,
  )
  expect(solver.state.regionIntersectionCaches).toBe(
    completedGreedySolver!.state.regionIntersectionCaches,
  )
  expect(solver.state.regionCongestionCost).toBe(
    completedGreedySolver!.state.regionCongestionCost,
  )
  expect(solver.state.regionSegments[1]).toEqual([[0, 0, 1]])
})
