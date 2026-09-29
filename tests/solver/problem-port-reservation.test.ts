import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("reserves a problem port for its declared net", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 1,
    regionCount: 1,
    regionIncidentPorts: [[0]],
    incidentPortRegion: [[0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(1),
    portX: new Float64Array(1),
    portY: new Float64Array(1),
    portZ: new Int32Array(1),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 0,
    portSectionMask: new Int8Array([1]),
    routeStartPort: new Int32Array(),
    routeEndPort: new Int32Array(),
    routeNet: new Int32Array(),
    regionNetId: new Int32Array([-1]),
    portReservationNetId: new Int32Array([4]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.state.currentRouteNetId = 4
  expect(solver.isPortReservedForDifferentNet(0)).toBe(false)

  solver.state.currentRouteNetId = 7
  expect(solver.isPortReservedForDifferentNet(0)).toBe(true)

  problem.portReservationNetId![0] = -2
  solver.state.currentRouteNetId = 4
  expect(solver.isPortReservedForDifferentNet(0)).toBe(true)
})
