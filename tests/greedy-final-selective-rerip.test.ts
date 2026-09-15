import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

class ObservableFinalRouteSolver extends SelectiveReripTinyHyperGraphSolver {
  finalSolver?: TinyHyperGraphSolver

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
  ): TinyHyperGraphSolver {
    this.finalSolver = super.createGreedyFinalRouteSolver(options)
    return this.finalSolver
  }

  completeRemainingRoutes(): boolean {
    return this.tryGreedyFinalRouteAcceptance()
  }
}

test("final routing selectively reopens a blocker and preserves unrelated routing", () => {
  const unusedBranchCount = 100
  const branchPortIds = Array.from(
    { length: unusedBranchCount },
    (_, i) => i + 9,
  )
  const portCount = 9 + unusedBranchCount
  const regionCount = 10 + unusedBranchCount
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts: [
      [0, 1, 3, 5, ...branchPortIds],
      [1, 2, 4, 6],
      [5, 6],
      [0],
      [2],
      [3],
      [4],
      [7, 8],
      [7],
      [8],
      ...branchPortIds.map((portId) => [portId]),
    ],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [1, 4],
      [0, 5],
      [1, 6],
      [0, 2],
      [1, 2],
      [7, 8],
      [7, 9],
      ...branchPortIds.map((_, i) => [0, i + 10]),
    ],
    regionWidth: new Float64Array(regionCount).fill(10),
    regionHeight: new Float64Array(regionCount).fill(10),
    regionCenterX: new Float64Array(regionCount),
    regionCenterY: new Float64Array(regionCount),
    regionAvailableZMask: new Int32Array(regionCount).fill(15),
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount),
    portX: new Float64Array([
      -2,
      0,
      2,
      -1,
      1,
      -1,
      1,
      10,
      12,
      ...branchPortIds.map(() => 0),
    ]),
    portY: new Float64Array([
      0,
      0,
      0,
      -1,
      -1,
      1,
      1,
      0,
      0,
      ...branchPortIds.map(() => -2),
    ]),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: new Int32Array([0, 3, 7]),
    routeEndPort: new Int32Array([2, 4, 8]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([
      -1,
      -1,
      0,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      ...branchPortIds.map(() => -1),
    ]),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 0, regionId: 1, fromPortId: 1, toPortId: 2 },
      { routeId: 2, regionId: 7, fromPortId: 7, toPortId: 8 },
    ],
  }
  const solver = new ObservableFinalRouteSolver(topology, problem, {
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 1,
  })
  const unrelatedSegments = structuredClone(solver.state.regionSegments[7])

  expect(solver.completeRemainingRoutes()).toBe(true)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.state.portAssignment[1]).toBe(1)
  expect(solver.state.portAssignment[5]).toBe(0)
  expect(solver.state.portAssignment[6]).toBe(0)
  expect(solver.state.regionSegments[7]).toEqual(unrelatedSegments)
  const finalSolver = solver.finalSolver
  expect(finalSolver).toBeInstanceOf(SelectiveReripTinyHyperGraphSolver)
  if (!(finalSolver instanceof SelectiveReripTinyHyperGraphSolver)) {
    throw new Error("Final routing did not retain selective blocker rerouting")
  }
  expect(finalSolver.iterations).toBeLessThan(unusedBranchCount)
  const completedRoute = solver
    .getOutput()
    .solvedRoutes?.find((route) => route.connection.connectionId === "route-1")
  expect(completedRoute?.path[0]?.portId).toBe("port-3")
  expect(completedRoute?.path.at(-1)?.portId).toBe("port-4")
  expect([...problem.routeStartPort]).toEqual([0, 3, 7])
  expect([...problem.routeEndPort]).toEqual([2, 4, 8])
  expect(finalSolver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(finalSolver.getSelectiveReripStats().selectivelyRippedRouteCount).toBe(
    1,
  )
})
