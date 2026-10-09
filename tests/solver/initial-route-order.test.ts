import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/core"

test("uses a validated initial route order", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 3,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2]],
    incidentPortRegion: [[0], [0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(3),
    portAngleForRegion2: new Int32Array(3),
    portX: new Float64Array(3),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(3).fill(1),
    routeStartPort: new Int32Array([0, 1, 2]),
    routeEndPort: new Int32Array([1, 2, 0]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array([-1]),
  }

  const solver = new TinyHyperGraphSolver(topology, problem, {
    INITIAL_ROUTE_ORDER: [2, 0, 1],
  })

  expect(solver.state.unroutedRoutes).toEqual([2, 0, 1])
  expect(
    () =>
      new TinyHyperGraphSolver(topology, problem, {
        INITIAL_ROUTE_ORDER: [2, 2, 1],
      }),
  ).toThrow("INITIAL_ROUTE_ORDER must contain every route id once")
})
