import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("a blocker cycle uses an alternate owner before resetting unrelated routes", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 13,
    regionCount: 13,
    regionIncidentPorts: [
      [0, 3, 7, 1, 5, 9],
      [2, 4, 8, 1, 6, 10],
      [5, 6],
      [9, 10],
      [11, 12],
      [0],
      [2],
      [3],
      [4],
      [7],
      [8],
      [11],
      [12],
    ],
    incidentPortRegion: [
      [0, 5],
      [0, 1],
      [1, 6],
      [0, 7],
      [1, 8],
      [0, 2],
      [2, 1],
      [0, 9],
      [1, 10],
      [0, 3],
      [3, 1],
      [4, 11],
      [4, 12],
    ],
    regionWidth: new Float64Array(13).fill(10),
    regionHeight: new Float64Array(13).fill(10),
    regionCenterX: new Float64Array(13),
    regionCenterY: new Float64Array(13),
    regionAvailableZMask: new Int32Array(13).fill(15),
    portAngleForRegion1: new Int32Array(13),
    portAngleForRegion2: new Int32Array(13),
    portX: new Float64Array([-2, 0, 2, -1, 1, -1, 1, -2, 2, -1, 1, 10, 12]),
    portY: new Float64Array([0, 0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 0, 0]),
    portZ: new Int32Array(13),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 4,
    portSectionMask: new Int8Array(13).fill(1),
    routeStartPort: new Int32Array([0, 3, 7, 11]),
    routeEndPort: new Int32Array([2, 4, 8, 12]),
    routeNet: new Int32Array([0, 1, 2, 3]),
    regionNetId: new Int32Array([
      -1, -1, -1, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    ]),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 0, regionId: 1, fromPortId: 1, toPortId: 2 },
      { routeId: 2, regionId: 0, fromPortId: 7, toPortId: 5 },
      { routeId: 2, regionId: 2, fromPortId: 5, toPortId: 6 },
      { routeId: 2, regionId: 1, fromPortId: 6, toPortId: 8 },
      { routeId: 3, regionId: 4, fromPortId: 11, toPortId: 12 },
    ],
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  const unrelatedSegments = structuredClone(solver.state.regionSegments[4])

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.state.portAssignment[1]).toBe(1)
  expect(solver.state.portAssignment[5]).toBe(0)
  expect(solver.state.portAssignment[6]).toBe(0)
  expect(solver.state.portAssignment[9]).toBe(2)
  expect(solver.state.portAssignment[10]).toBe(2)
  expect(solver.state.regionSegments[4]).toEqual(unrelatedSegments)
  expect(solver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(solver.getSelectiveReripStats().alternateOwnerCount).toBe(1)
  expect(solver.getSelectiveReripStats().selectivelyRippedRouteCount).toBe(2)
})
