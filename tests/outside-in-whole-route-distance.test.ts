import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("whole routes use both frontiers beyond the partial-span distance limit", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 6,
    regionIncidentPorts: [[0], [0, 1], [1, 2], [2, 3], [3, 4], [4]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ],
    regionWidth: new Float64Array(6).fill(25),
    regionHeight: new Float64Array(6).fill(10),
    regionCenterX: new Float64Array([-12.5, 12.5, 37.5, 62.5, 87.5, 112.5]),
    regionCenterY: new Float64Array(6),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 0]),
    portAngleForRegion2: new Int32Array([0, 18000, 18000, 18000, 18000]),
    portX: new Float64Array([0, 25, 50, 75, 100]),
    portY: new Float64Array(5),
    portZ: new Int32Array(5),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(5).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([4]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(6).fill(-1),
  }
  const solver = new OutsideInPartialRipTinyHyperGraphSolver(
    topology,
    problem,
    {
      OUTSIDE_IN_MAX_DISTANCE: 24,
    },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.outsideInCompletedRouteCount).toBe(1)
  expect(solver.stats.outsideInForwardExpansionCount).toBeGreaterThan(0)
  expect(solver.stats.outsideInReverseExpansionCount).toBeGreaterThan(0)
  expect(solver.stats.outsideInDistancePruneCount).toBe(0)
  expect(solver.stats.outsideInFallbackRouteCount).toBe(0)
  expect(solver.getOutput().solvedRoutes?.[0]?.path).toHaveLength(5)
})
