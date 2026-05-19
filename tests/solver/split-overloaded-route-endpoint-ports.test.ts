import { expect, test } from "bun:test"
import {
  splitOverloadedRouteEndpointPorts,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const createSharedEndpointProblem = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 3,
    regionIncidentPorts: [[0], [0, 1], [1]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
    ],
    regionWidth: new Float64Array([1, 4, 1]),
    regionHeight: new Float64Array([1, 1, 1]),
    regionCenterX: new Float64Array([-2, 0, 2]),
    regionCenterY: new Float64Array([0, 0, 0]),
    portAngleForRegion1: new Int32Array([0, 18000]),
    portAngleForRegion2: new Int32Array([18000, 0]),
    portX: new Float64Array([-1, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
    portMetadata: [{ portId: "start" }, { portId: "end" }],
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array([1, 1]),
    routeMetadata: [
      {
        connectionId: "route-a",
        startRegionId: "source",
        endRegionId: "sink",
      },
      {
        connectionId: "route-b",
        startRegionId: "source",
        endRegionId: "sink",
      },
    ],
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 1]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1, -1, -1]),
  }

  return { topology, problem }
}

test("splitting overloaded route endpoint ports lets different-net routes share a physical endpoint", () => {
  const { topology, problem } = createSharedEndpointProblem()
  const rawSolver = new TinyHyperGraphSolver(topology, problem)

  rawSolver.solve()

  expect(rawSolver.solved).toBe(false)
  expect(rawSolver.failed).toBe(true)

  const repaired = splitOverloadedRouteEndpointPorts(topology, problem)
  const repairedSolver = new TinyHyperGraphSolver(
    repaired.topology,
    repaired.problem,
  )

  repairedSolver.solve()

  expect(repaired.clonedPortCount).toBe(2)
  expect(repaired.topology.portCount).toBe(4)
  expect(Array.from(repaired.problem.routeStartPort)).toEqual([0, 2])
  expect(Array.from(repaired.problem.routeEndPort)).toEqual([1, 3])
  expect(repairedSolver.solved).toBe(true)
  expect(repairedSolver.failed).toBe(false)
  expect(repairedSolver.getOutput().solvedRoutes).toHaveLength(2)
})
