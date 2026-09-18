import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("greedy completion restores a displaced route and preserves unrelated assignments", (): void => {
  const solver = new SelectiveReripTinyHyperGraphSolver(
    {
      portCount: 11,
      regionCount: 11,
      regionIncidentPorts: [
        [0, 2, 3, 4],
        [1, 2, 5, 6],
        [3, 6],
        [0],
        [1],
        [4],
        [5],
        [7, 8, 9, 10],
        [9, 10],
        [7],
        [8],
      ],
      incidentPortRegion: [
        [0, 3],
        [1, 4],
        [0, 1],
        [0, 2],
        [0, 5],
        [1, 6],
        [1, 2],
        [7, 9],
        [7, 10],
        [7, 8],
        [7, 8],
      ],
      regionWidth: new Float64Array([2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2]),
      regionHeight: new Float64Array(11).fill(2),
      regionCenterX: new Float64Array([-1, 1, 0, -3, 3, -3, 3, 6, 6, 4, 8]),
      regionCenterY: new Float64Array([
        0, 0, 2, 0.5, 0.5, -0.5, -0.5, 0, 2, -0.5, -0.5,
      ]),
      regionAvailableZMask: new Int32Array(11).fill(1),
      portAngleForRegion1: new Int32Array([
        20250, 6750, 2250, 13500, 24750, 2250, 13500, 24750, 2250, 15750, 11250,
      ]),
      portAngleForRegion2: new Int32Array([
        0, 18000, 24750, 29250, 0, 18000, 33750, 0, 18000, 29250, 33750,
      ]),
      portX: new Float64Array([-2, 2, 0, -1, -2, 2, 1, 5, 7, 5.5, 6.5]),
      portY: new Float64Array([
        0.5, 0.5, -0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 1, 1,
      ]),
      portZ: new Int32Array(11),
    },
    {
      routeCount: 3,
      portSectionMask: new Int8Array(11).fill(1),
      routeStartPort: new Int32Array([0, 4, 7]),
      routeEndPort: new Int32Array([1, 5, 8]),
      routeNet: new Int32Array([0, 1, 2]),
      regionNetId: new Int32Array([-1, -1, 0, -1, -1, -1, -1, -1, -1, -1, -1]),
      initialAssignments: [
        { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
        { routeId: 0, regionId: 1, fromPortId: 2, toPortId: 1 },
        { routeId: 2, regionId: 7, fromPortId: 7, toPortId: 9 },
        { routeId: 2, regionId: 8, fromPortId: 9, toPortId: 10 },
        { routeId: 2, regionId: 7, fromPortId: 10, toPortId: 8 },
      ],
    },
    { ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true, GREEDY_FINAL_ROUTE_ITERS: 1 },
  )

  expect(solver.state.unroutedRoutes).toEqual([1])
  solver.tryFinalAcceptance()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
  expect(solver.getOutput().solvedRoutes).toHaveLength(3)
  expect(solver.state.portAssignment[2]).toBe(1)
  expect(solver.state.regionSegments[2]).toEqual([[0, 3, 6]])
  expect(solver.state.regionSegments[7]).toEqual([
    [2, 7, 9],
    [2, 10, 8],
  ])
  expect(solver.state.regionSegments[8]).toEqual([[2, 9, 10]])
  expect(
    solver.state.regionIntersectionCaches.every(
      (cache) => cache.existingSameLayerIntersections === 0,
    ),
  ).toBe(true)
  expect(
    getSvgFromGraphicsObject(solver.visualize(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
