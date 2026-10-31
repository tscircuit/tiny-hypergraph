import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"

test("completion routes around a crossing when the region cannot fit a via", () => {
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 7,
      regionCount: 6,
      regionIncidentPorts: [[0, 1, 2, 3, 4, 5], [4, 5], [0], [1], [2], [3, 6]],
      incidentPortRegion: [[2, 0], [0, 3], [4, 0], [0, 5], [0, 1], [0, 1], [5]],
      regionWidth: new Float64Array([0.2, 1, 1, 1, 1, 1]),
      regionHeight: new Float64Array([0.2, 1, 1, 1, 1, 1]),
      regionCenterX: new Float64Array([0, 0.6, -1, 1, 0, 0]),
      regionCenterY: new Float64Array([0, 0, 0, 0, -1, 1]),
      regionAvailableZMask: new Int32Array([3, 3, 1, 1, 1, 1]),
      portAngleForRegion1: new Int32Array([0, 0, 0, 9000, 33343, 2656, 0]),
      portAngleForRegion2: new Int32Array([
        18000, 0, 27000, 0, 18571, 17429, 0,
      ]),
      portX: new Float64Array([-0.1, 0.1, 0, 0, 0.1, 0.1, 0]),
      portY: new Float64Array([0, 0, -0.1, 0.1, -0.05, 0.05, 0.5]),
      portZ: new Int32Array(7),
    },
    {
      routeCount: 2,
      portSectionMask: new Int8Array(7).fill(1),
      routeStartPort: new Int32Array([0, 2]),
      routeEndPort: new Int32Array([1, 6]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array([-1, -1, 0, 0, 1, 1]),
    },
    {
      minViaPadDiameter: 0.3,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      GREEDY_FINAL_ROUTE_ITERS: 1,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )

  solver.tryFinalAcceptance()

  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[1].some(([route]) => route === 1)).toBe(
    true,
  )
  expect(
    solver.state.regionSegments[0].some(
      ([route, start, end]) => route === 1 && start === 2 && end === 3,
    ),
  ).toBe(false)
})
