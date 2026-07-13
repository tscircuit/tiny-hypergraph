import { expect, test } from "bun:test"
import {
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("selective rerip routes larger nets first while preserving tie order", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 0,
    regionCount: 0,
    regionIncidentPorts: [],
    incidentPortRegion: [],
    regionWidth: new Float64Array(0),
    regionHeight: new Float64Array(0),
    regionCenterX: new Float64Array(0),
    regionCenterY: new Float64Array(0),
    portAngleForRegion1: new Int32Array(0),
    portAngleForRegion2: new Int32Array(0),
    portX: new Float64Array(0),
    portY: new Float64Array(0),
    portZ: new Int32Array(0),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 7,
    portSectionMask: new Int8Array(0),
    routeStartPort: new Int32Array(7),
    routeEndPort: new Int32Array(7),
    routeNet: Int32Array.from([0, 1, 0, 2, 1, 0, 3]),
    regionNetId: new Int32Array(0),
  }

  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem)

  expect(solver.state.unroutedRoutes).toEqual([0, 2, 5, 1, 4, 3, 6])
})
