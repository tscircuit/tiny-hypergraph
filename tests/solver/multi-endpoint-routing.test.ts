import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const createMultiEndpointTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 3,
  regionIncidentPorts: [
    [0, 1],
    [0, 1, 2, 3],
    [2, 3],
  ],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [1, 2],
    [1, 2],
  ],
  regionWidth: new Float64Array([1, 4, 1]),
  regionHeight: new Float64Array([1, 1, 1]),
  regionCenterX: new Float64Array([0, 1, 2]),
  regionCenterY: new Float64Array(3).fill(0),
  portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
  portAngleForRegion2: new Int32Array([18000, 27000, 0, 9000]),
  portX: new Float64Array([0, 0, 2, 2]),
  portY: new Float64Array([0, 1, 0, 1]),
  portZ: new Int32Array(4).fill(0),
})

const createMultiEndpointProblem = (
  overrides?: Partial<TinyHyperGraphProblem>,
): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(4).fill(1),
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([2]),
  routeStartPortCandidates: [[0, 1]],
  routeEndPortCandidates: [[2, 3]],
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array([0, -1, 0]),
  ...overrides,
})

test("solver can route through alternate bus endpoint candidates", () => {
  const solver = new TinyHyperGraphSolver(
    createMultiEndpointTopology(),
    createMultiEndpointProblem(),
    { MAX_ITERATIONS: 50 },
  )

  solver.problemSetup.portEndpointNetIds[0]?.add(1)
  solver.problemSetup.portEndpointNetIds[2]?.add(1)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.goalPortId).toBe(3)
  expect(solver.state.regionSegments[1]).toEqual([[0, 1, 3]])
})

test("solver getOutput preserves actual alternate endpoints chosen during routing", () => {
  const solver = new TinyHyperGraphSolver(
    createMultiEndpointTopology(),
    createMultiEndpointProblem(),
    { MAX_ITERATIONS: 50 },
  )

  solver.problemSetup.portEndpointNetIds[0]?.add(1)
  solver.problemSetup.portEndpointNetIds[2]?.add(1)
  solver.solve()

  const roundTripped = loadSerializedHyperGraph(solver.getOutput())

  expect(roundTripped.problem.routeStartPort[0]).toBe(1)
  expect(roundTripped.problem.routeEndPort[0]).toBe(3)
  expect(roundTripped.solution.solvedRoutePathSegments[0]).toEqual([[1, 3]])
})
