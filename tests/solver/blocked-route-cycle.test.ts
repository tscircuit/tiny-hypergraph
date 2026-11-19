import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("skips every cyclic owner when choosing a blocker to move", () => {
  // A is blocked by B's short corridor, C's upper corridor, and D's lower
  // corridor. B and C previously needed A to move. Only D is independent;
  // it can relocate to its reserved outer corridor while B and C stay put.
  const solver = new SelectiveReripTinyHyperGraphSolver(
    {
      portCount: 15,
      regionCount: 5,
      regionIncidentPorts: [
        [0, 2, 4, 6, 8, 9, 11, 13],
        [1, 3, 5, 7, 8, 10, 12, 14],
        [9, 10],
        [11, 12],
        [13, 14],
      ],
      incidentPortRegion: [
        [0],
        [1],
        [0],
        [1],
        [0],
        [1],
        [0],
        [1],
        [0, 1],
        [0, 2],
        [2, 1],
        [0, 3],
        [3, 1],
        [0, 4],
        [4, 1],
      ],
      regionWidth: new Float64Array(5).fill(4),
      regionHeight: new Float64Array(5).fill(4),
      regionCenterX: new Float64Array([0, 4, 2, 2, 2]),
      regionCenterY: new Float64Array([0, 0, 3, -3, -7]),
      regionAvailableZMask: new Int32Array(5).fill(3),
      portAngleForRegion1: new Int32Array(15),
      portAngleForRegion2: new Int32Array(15),
      portX: new Float64Array([
        -2, 6, -1, 5, -1, 5, -1, 5, 2, 0, 4, 0, 4, 0, 4,
      ]),
      portY: new Float64Array([
        1, 1, 0, 0, 2, 2, -2, -2, 0, 3, 3, -3, -3, -7, -7,
      ]),
      portZ: new Int32Array(15),
    },
    {
      routeCount: 4,
      routeStartPort: new Int32Array([0, 2, 4, 6]),
      routeEndPort: new Int32Array([1, 3, 5, 7]),
      routeNet: new Int32Array([0, 1, 2, 3]),
      regionNetId: new Int32Array([-1, -1, -1, -1, 3]),
      portSectionMask: new Int8Array(15).fill(1),
      initialAssignments: [
        { routeId: 1, regionId: 0, fromPortId: 2, toPortId: 8 },
        { routeId: 1, regionId: 1, fromPortId: 8, toPortId: 3 },
        { routeId: 2, regionId: 0, fromPortId: 4, toPortId: 9 },
        { routeId: 2, regionId: 2, fromPortId: 9, toPortId: 10 },
        { routeId: 2, regionId: 1, fromPortId: 10, toPortId: 5 },
        { routeId: 3, regionId: 0, fromPortId: 6, toPortId: 11 },
        { routeId: 3, regionId: 3, fromPortId: 11, toPortId: 12 },
        { routeId: 3, regionId: 1, fromPortId: 12, toPortId: 7 },
      ],
    },
    { STATIC_REACHABILITY_PRECHECK: false, EARLY_BLOCKER_RECOVERY: true },
  )
  solver["incrementFailedOwnerPair"](1, 0)
  solver["incrementFailedOwnerPair"](2, 0)

  solver.step()
  solver.step()

  expect(solver.getSelectiveReripStats().lastRippedRouteIds).toEqual([3])
  expect(solver.getSelectiveReripStats().failedOwnerPairs).toEqual([
    { failedRouteId: 0, ownerRouteId: 3, count: 1 },
    { failedRouteId: 1, ownerRouteId: 0, count: 1 },
    { failedRouteId: 2, ownerRouteId: 0, count: 1 },
  ])
  expect(solver.state.portAssignment[8]).toBe(1)
  expect(solver.state.regionSegments[2]).toEqual([[2, 9, 10]])

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(solver.state.regionSegments[3]).toEqual([[0, 11, 12]])
  expect(solver.state.regionSegments[4]).toEqual([[3, 13, 14]])
})
