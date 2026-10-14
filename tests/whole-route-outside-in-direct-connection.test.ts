import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("outside-in search connects endpoints before both roots expand", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: Float64Array.of(10),
    regionHeight: Float64Array.of(10),
    regionCenterX: Float64Array.of(5),
    regionCenterY: Float64Array.of(0),
    portAngleForRegion1: Int32Array.of(0, 18_000),
    portAngleForRegion2: new Int32Array(2),
    portX: Float64Array.of(0, 10),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(1),
    routeNet: Int32Array.of(0),
    regionNetId: Int32Array.of(-1),
  }
  const solver = new OutsideInPartialRipTinyHyperGraphSolver(
    topology,
    problem,
    {
      PARTIAL_RIP_ENABLED: false,
      OUTSIDE_IN_ROUTING: true,
      WHOLE_ROUTE_OUTSIDE_IN_ROUTING: true,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.outsideInForwardExpansionCount).toBe(1)
  expect(solver.stats.outsideInReverseExpansionCount).toBe(0)
})
