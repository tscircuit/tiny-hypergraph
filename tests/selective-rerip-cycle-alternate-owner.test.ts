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
    routeStartPort: new Int32Array([0, 7, 11, 3]),
    routeEndPort: new Int32Array([2, 8, 12, 4]),
    routeNet: new Int32Array([0, 2, 3, 1]),
    regionNetId: new Int32Array([
      -1, -1, -1, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    ]),
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver.solve()

  expect(solver.solved, solver.error ?? JSON.stringify(solver.stats)).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.state.portAssignment[1]).toBe(1)
  expect(solver.state.portAssignment[5]).toBe(0)
  expect(solver.state.portAssignment[6]).toBe(0)
  expect(solver.state.portAssignment[9]).toBe(2)
  expect(solver.state.portAssignment[10]).toBe(2)
  expect(solver.state.regionSegments[4]).toEqual([[2, 11, 12]])
  expect(solver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(solver.getSelectiveReripStats().alternateOwnerCount).toBe(1)
  expect(solver.getSelectiveReripStats().selectivelyRippedRouteCount).toBe(2)
  // B displaced A, then A displaced C through the alternate corridor. The
  // rejected A -> B choice must not replace that actual A -> C dependency.
  expect(solver.getSelectiveReripStats().failedOwnerPairs).toEqual([
    { failedRouteId: 0, ownerRouteId: 1, count: 1 },
    { failedRouteId: 3, ownerRouteId: 0, count: 1 },
  ])
})
