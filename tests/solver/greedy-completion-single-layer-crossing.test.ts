import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"

test("completion never accepts two crossing nets in a single-layer region", (): void => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const solver = new Solver(
      {
        portCount: 4,
        regionCount: 2,
        regionIncidentPorts: [[0, 1, 2, 3], []],
        incidentPortRegion: [
          [0, 1],
          [0, 1],
          [0, 1],
          [0, 1],
        ],
        regionWidth: new Float64Array([3, 1]),
        regionHeight: new Float64Array([3, 1]),
        regionCenterX: new Float64Array(2),
        regionCenterY: new Float64Array(2),
        regionAvailableZMask: new Int32Array([1, 0]),
        portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
        portAngleForRegion2: new Int32Array(4),
        portX: new Float64Array([1, 0, -1, 0]),
        portY: new Float64Array([0, 1, 0, -1]),
        portZ: new Int32Array(4),
      },
      {
        routeCount: 2,
        portSectionMask: new Int8Array(4).fill(1),
        routeStartPort: new Int32Array([0, 1]),
        routeEndPort: new Int32Array([2, 3]),
        routeNet: new Int32Array([0, 1]),
        regionNetId: new Int32Array(2).fill(-1),
      },
      {
        MAX_ITERATIONS: 100,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
        GREEDY_FINAL_ROUTE_ITERS: 1,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        STATIC_REACHABILITY_PRECHECK: false,
      },
    )
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
  }
})
