import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { PortId, RouteId } from "lib/types"

class RouteHeuristicTestSolver extends TinyHyperGraphSolver {
  getRouteHeuristicForTest(routeId: RouteId, portId: PortId): number {
    return this.getRouteHeuristic(routeId, portId)
  }
}

test("route heuristics reuse one port-sized memo across route changes", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 3,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2]],
    incidentPortRegion: [[0], [0], [0]],
    regionWidth: new Float64Array([2]),
    regionHeight: new Float64Array([2]),
    regionCenterX: new Float64Array([1]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(3),
    portX: new Float64Array([0, 1, 2]),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(3).fill(1),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 2]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new RouteHeuristicTestSolver(topology, problem, {
    DISTANCE_TO_COST: 1,
  })

  expect(solver.getRouteHeuristicForTest(0, 0)).toBe(1)
  expect(solver.getRouteHeuristicForTest(0, 2)).toBe(1)
  expect(solver.getRouteHeuristicForTest(1, 0)).toBe(2)
  expect(solver.getRouteHeuristicForTest(0, 0)).toBe(1)
  expect("portHCostToEndOfRoute" in solver.problemSetup).toBeFalse()
})
