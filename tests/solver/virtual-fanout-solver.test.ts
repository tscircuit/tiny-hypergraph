import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  TinyHyperGraphVirtualFanoutSolver,
} from "lib/index"

const createSharedInternalPortProblem = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 6,
    regionIncidentPorts: [[0], [0, 1, 2], [2, 3, 4], [3], [1], [4]],
    incidentPortRegion: [
      [1, 0],
      [1, 4],
      [1, 2],
      [2, 3],
      [2, 5],
    ],
    regionWidth: new Float64Array([1, 2, 2, 1, 1, 1]),
    regionHeight: new Float64Array([1, 1, 1, 1, 1, 1]),
    regionCenterX: new Float64Array([-2, -1, 1, 2, -2, 2]),
    regionCenterY: new Float64Array([0, 0, 0, 0.5, -0.5, -0.5]),
    portAngleForRegion1: new Int32Array([0, 0, 0, 18000, 18000]),
    portAngleForRegion2: new Int32Array([18000, 18000, 0, 0, 0]),
    portX: new Float64Array([-1.5, -0.25, 0, 1.5, 1.5]),
    portY: new Float64Array([0, 0.25, 0, 0.5, -0.5]),
    portZ: new Int32Array([0, 0, 0, 0, 0]),
    portMetadata: [
      { portId: "a-start" },
      { portId: "b-start" },
      { portId: "shared-choke" },
      { portId: "a-end" },
      { portId: "b-end" },
    ],
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(topology.portCount).fill(1),
    routeMetadata: [
      {
        connectionId: "route-a",
        startRegionId: "a-source",
        endRegionId: "a-sink",
      },
      {
        connectionId: "route-b",
        startRegionId: "b-source",
        endRegionId: "b-sink",
      },
    ],
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([3, 4]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1, -1, -1, -1, -1, -1]),
  }

  return { topology, problem }
}

test("virtual fanout solves different-net routes through a shared internal port", () => {
  const { topology, problem } = createSharedInternalPortProblem()
  const rawSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100,
  })

  rawSolver.solve()

  expect(rawSolver.solved).toBe(false)
  expect(rawSolver.failed).toBe(true)

  const fanoutSolver = new TinyHyperGraphVirtualFanoutSolver(
    topology,
    problem,
    {
      MAX_ITERATIONS: 100,
    },
  )

  fanoutSolver.solve()

  expect(fanoutSolver.solved).toBe(true)
  expect(fanoutSolver.failed).toBe(false)
  expect(fanoutSolver.stats.virtualFanout).toBe(true)
  expect(fanoutSolver.getOutput().solvedRoutes).toHaveLength(2)
})
