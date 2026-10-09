import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { PortId, RegionId, RouteId } from "lib/types"

class PartialRipHeuristicTestSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  prepareForTest(hotRegionIds: RegionId[], regionCosts: Float64Array): boolean {
    return this.preparePartialRip(hotRegionIds, regionCosts)
  }

  getRouteHeuristicForTest(routeId: RouteId, portId: PortId): number {
    return this.getRouteHeuristic(routeId, portId)
  }

  getActiveEndPortIdForTest(routeId: RouteId): PortId {
    return this.getRouteEndPortId(routeId)
  }
}

test("route heuristic cache follows a partial-rip endpoint change", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 6,
    regionIncidentPorts: [[0], [0, 1], [1, 2], [2, 3], [3, 4], [4]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ],
    regionWidth: new Float64Array(6).fill(100),
    regionHeight: new Float64Array(6).fill(100),
    regionCenterX: new Float64Array([0, 2.5, 7.5, 12.5, 17.5, 20]),
    regionCenterY: new Float64Array(6),
    portAngleForRegion1: new Int32Array(5),
    portAngleForRegion2: new Int32Array(5),
    portX: new Float64Array([0, 5, 10, 15, 20]),
    portY: new Float64Array(5),
    portZ: new Int32Array(5),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(5).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([4]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(6).fill(-1),
  }
  const solver = new PartialRipHeuristicTestSolver(topology, problem, {
    DISTANCE_TO_COST: 1,
    PARTIAL_RIP_MAX_DISTANCE: 3,
    PARTIAL_RIP_MAX_ATTEMPTS: 1,
  })
  solver.state.portAssignment.fill(0)
  solver.state.unroutedRoutes = []
  solver.state.regionSegments[1] = [[0, 0, 1]]
  solver.state.regionSegments[2] = [[0, 1, 2]]
  solver.state.regionSegments[3] = [[0, 2, 3]]
  solver.state.regionSegments[4] = [[0, 3, 4]]

  expect(solver.getRouteHeuristicForTest(0, 0)).toBe(20)

  const regionCosts = new Float64Array(6)
  regionCosts[3] = 1
  expect(solver.prepareForTest([3], regionCosts)).toBe(true)
  expect(solver.getActiveEndPortIdForTest(0)).toBe(3)
  expect(solver.getRouteHeuristicForTest(0, 0)).toBe(15)
})
