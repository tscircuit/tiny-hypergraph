import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("precomputes endpoint reservation behavior for zero, one, and multiple nets", () => {
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
    routeCount: 2,
    portSectionMask: new Int8Array([1, 1, 1, 1]),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 2]),
    routeNet: new Int32Array([4, 7]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })

  expect([...solver.problemSetup.portEndpointReservationNetId]).toEqual([
    -2, 4, 7, -1,
  ])

  solver.state.currentRouteNetId = 4
  expect(solver.isPortReservedForDifferentNet(0)).toBe(true)
  expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
  expect(solver.isPortReservedForDifferentNet(2)).toBe(true)
  expect(solver.isPortReservedForDifferentNet(3)).toBe(false)
})
