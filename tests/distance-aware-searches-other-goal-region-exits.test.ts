import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../lib/core"

test("explores other exits when a direct transition to the goal is blocked", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 3,
    regionIncidentPorts: [[1, 0, 2, 3, 4], [2, 5], [5, 1]],
    incidentPortRegion: [[0], [0, 2], [0, 1], [0], [0], [1, 2]],
    regionWidth: new Float64Array(3).fill(2),
    regionHeight: new Float64Array(3).fill(2),
    regionCenterX: new Float64Array(3),
    regionCenterY: new Float64Array(3),
    regionAvailableZMask: new Int32Array(3).fill(1),
    portAngleForRegion1: new Int32Array([270, 90, 225, 0, 180, 0]),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 0, -1, 1, -1, -2]),
    portY: new Float64Array([-1, 1, -1, 0, 0, 1]),
    portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 3]),
    routeEndPort: new Int32Array([1, 4]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(3).fill(-1),
    initialAssignments: [{ routeId: 1, regionId: 0, fromPortId: 3, toPortId: 4 }],
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    MAX_ITERATIONS: 40,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.state.ripCount).toBe(0)
  expect(solver.state.regionSegments[0]).toEqual([[1, 3, 4], [0, 0, 2]])
  expect(solver.state.regionSegments[1]).toEqual([[0, 2, 5]])
  expect(solver.state.regionSegments[2]).toEqual([[0, 5, 1]])
})
