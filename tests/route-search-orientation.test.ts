import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"

const topology: TinyHyperGraphTopology = {
  portCount: 6,
  regionCount: 2,
  regionIncidentPorts: [
    [0, 2],
    [1, 3, 4, 5],
  ],
  incidentPortRegion: [[0], [1], [0], [1], [1], [1]],
  regionWidth: Float64Array.from([1, 1]),
  regionHeight: Float64Array.from([1, 1]),
  regionCenterX: Float64Array.from([0, 10]),
  regionCenterY: Float64Array.from([0, 0]),
  portAngleForRegion1: new Int32Array(6),
  portX: Float64Array.from([0, 10, 0, 10, 10, 10]),
  portY: Float64Array.from([0, 0, 1, 1, 2, 3]),
  portZ: new Int32Array(6),
}

const createProblem = (): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: Int8Array.from([1, 1, 1, 1, 1, 1]),
  routeStartPort: Int32Array.from([0]),
  routeEndPort: Int32Array.from([1]),
  routeNet: Int32Array.from([0]),
  regionNetId: Int32Array.from([-1, -1]),
})

test("orients a cost-symmetric route toward its lower-fanout endpoint", () => {
  const problem = createProblem()
  const solver = new TinyHyperGraphSolver(topology, problem, {
    ORIENT_ROUTE_SEARCH_BY_TARGET_FANOUT: true,
  })

  expect(solver.problemSetup.routeSearchReversed[0]).toBe(1)

  problem.portPenalty = Float64Array.from([1, 0, 0, 0, 0, 0])
  solver.resetForProblem(problem)

  expect(solver.problemSetup.routeSearchReversed[0]).toBe(0)
})

