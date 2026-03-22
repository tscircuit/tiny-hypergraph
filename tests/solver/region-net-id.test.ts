import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

test("solver does not traverse regions reserved for a different net", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 5,
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [0], [3]],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [1, 2],
      [2, 4],
    ],
    regionWidth: new Float64Array(5).fill(1),
    regionHeight: new Float64Array(5).fill(1),
    regionCenterX: new Float64Array(5).fill(0),
    regionCenterY: new Float64Array(5).fill(0),
    portAngleForRegion1: new Int32Array(4),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([0, 1, 2, 3]),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: Int32Array.from([-1, 1, -1, -1, -1]),
  }

  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.step()
  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("No candidates left")
})
