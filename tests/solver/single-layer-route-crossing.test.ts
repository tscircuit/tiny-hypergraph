import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "../../lib"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"

test("single-layer route policies block crossings while other routes retain spare layers", () => {
  const topology: TinyHyperGraphTopology = {
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
    regionAvailableZMask: new Int32Array([3, 0]),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([1, 0, -1, 0]),
    portY: new Float64Array([0, 1, 0, -1]),
    portZ: new Int32Array(4),
  }
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    for (const [ownerAllowedZ, currentAllowedZ, solved] of [
      [[0], [0], false],
      [[0], undefined, true],
      [undefined, [0], true],
      [[0, 1], [0], true],
      [[0], [0, 1], true],
    ] as const) {
      const problem: TinyHyperGraphProblem = {
        routeCount: 3,
        portSectionMask: new Int8Array(4).fill(1),
        routeStartPort: new Int32Array([0, 1, 0]),
        routeEndPort: new Int32Array([2, 3, 2]),
        routeNet: new Int32Array([0, 1, 0]),
        regionNetId: new Int32Array(2).fill(-1),
        routeAllowedZ: [ownerAllowedZ, currentAllowedZ, undefined],
        initialAssignments: [
          { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
        ],
        routeIsFixed: new Uint8Array([1, 0, 0]),
      }
      const solver = new Solver(topology, problem, { MAX_ITERATIONS: 100 })
      solver.solve()
      expect(solver.solved).toBe(solved)
      if (solved) expect(solver.failed).toBe(false)
    }
  }
})
