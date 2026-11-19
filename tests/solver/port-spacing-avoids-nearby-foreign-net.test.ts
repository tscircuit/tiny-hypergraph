import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

test("routes around a nearby occupied port on the same layer", () => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    for (const completion of [false, true]) {
      const solver = new Solver(
        {
          portCount: 6,
          regionCount: 6,
          regionIncidentPorts: [[0, 2, 3, 4, 5], [1, 2, 3], [0], [1], [4], [5]],
          incidentPortRegion: [
            [0, 2],
            [1, 3],
            [0, 1],
            [0, 1],
            [0, 4],
            [0, 5],
          ],
          regionWidth: new Float64Array(6).fill(2),
          regionHeight: new Float64Array(6).fill(2),
          regionCenterX: new Float64Array([-1, 1, -2, 2, -1, -1]),
          regionCenterY: new Float64Array(6),
          portAngleForRegion1: new Int32Array([0, 0, 0, 9000, 0, 9000]),
          portAngleForRegion2: new Int32Array([0, 0, 18000, 18000, 0, 0]),
          portX: new Float64Array([-1, 1, 0, 0, 0, -1]),
          portY: new Float64Array([0, 0, 0, 0.5, 0.05, 0.5]),
          portZ: new Int32Array(6),
        },
        {
          routeCount: 2,
          portSectionMask: new Int8Array(6).fill(1),
          routeStartPort: new Int32Array([4, 0]),
          routeEndPort: new Int32Array([5, 1]),
          routeNet: new Int32Array([1, 0]),
          regionNetId: new Int32Array([-1, -1, 0, 0, 1, 1]),
        },
        {
          minPortSpacing: 0.3,
          STATIC_REACHABILITY_PRECHECK: false,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
          GREEDY_FINAL_ROUTE_ITERS: 1,
        },
      )
      if (completion) solver.tryFinalAcceptance()
      else solver.solve()

      expect(solver.solved).toBe(true)
      expect(solver.state.portAssignment[2]).toBe(-1)
      expect(solver.state.portAssignment[3]).toBe(0)
    }
  }
})
