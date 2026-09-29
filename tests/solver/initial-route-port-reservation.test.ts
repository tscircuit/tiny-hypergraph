import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("releases a route-owned port reservation after all original copper is ripped", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(4),
    portX: new Float64Array(4),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1, 1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([4]),
    regionNetId: new Int32Array([-1]),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 0, regionId: 0, fromPortId: 1, toPortId: 3 },
    ],
    initialRoutePortReservations: [{ portId: 2, ownerRouteId: 0 }],
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.state.currentRouteNetId = 7
  expect(solver.isPortReservedForDifferentNet(2)).toBe(true)
  solver.state.currentRouteNetId = 4
  expect(solver.isPortReservedForDifferentNet(2)).toBe(false)

  solver.state.regionSegments[0] = solver.state.regionSegments[0]!.slice(1)
  solver.state.currentRouteNetId = 7
  expect(solver.isPortReservedForDifferentNet(2)).toBe(true)

  solver.resetRoutingStateForRerip()
  solver.state.currentRouteNetId = 7
  expect(solver.isPortReservedForDifferentNet(2)).toBe(false)
})
