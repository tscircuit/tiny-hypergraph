import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"

test("completion changes layers in a region with room for the via", () => {
  for (const ownsNarrowRegion of [false, true]) {
    const solver = new TinyHyperGraphSolver(
      {
        portCount: 4,
        regionCount: 4,
        regionIncidentPorts: [[0, 1, 2, 3], [2, 3], [0], [1]],
        incidentPortRegion: [
          [0, 2],
          [0, 3],
          [0, 1],
          [0, 1],
        ],
        regionWidth: new Float64Array([0.1, 2, 0.1, 0.1]),
        regionHeight: new Float64Array(4).fill(2),
        regionCenterX: new Float64Array([0, 1.05, -0.1, -0.1]),
        regionCenterY: new Float64Array(4),
        regionAvailableZMask: new Int32Array([3, 3, 1, 2]),
        portAngleForRegion1: new Int32Array(4),
        portAngleForRegion2: new Int32Array(4),
        portX: new Float64Array([-0.05, -0.05, 0.05, 0.05]),
        portY: new Float64Array(4),
        portZ: new Int32Array([0, 1, 0, 1]),
      },
      {
        routeCount: 1,
        portSectionMask: new Int8Array(4).fill(1),
        routeStartPort: new Int32Array([0]),
        routeEndPort: new Int32Array([1]),
        routeNet: new Int32Array([0]),
        regionNetId: new Int32Array([ownsNarrowRegion ? 0 : -1, -1, 0, 0]),
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
    const viaRegion = ownsNarrowRegion ? 0 : 1
    expect(
      solver.state.regionSegments[viaRegion].some(
        ([, start, end]) =>
          solver.topology.portZ[start] !== solver.topology.portZ[end],
      ),
    ).toBe(true)
    if (!ownsNarrowRegion) {
      expect(
        solver.state.regionSegments[0].every(
          ([, start, end]) =>
            solver.topology.portZ[start] === solver.topology.portZ[end],
        ),
      ).toBe(true)
    }
  }
})
