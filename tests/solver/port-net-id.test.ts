import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("port restrictions preserve same-net access and reject foreign or blocked copper", () => {
  for (const reservedNetId of [-1, 0, 1, -2]) {
    const topology: TinyHyperGraphTopology = {
      portCount: 4,
      regionCount: 5,
      regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [0], [3]],
      incidentPortRegion: [
        [0, 3],
        [0, 1],
        [1, 2],
        [2, 4],
      ],
      regionWidth: new Float64Array(5).fill(1),
      regionHeight: new Float64Array(5).fill(1),
      regionCenterX: new Float64Array(5).fill(0),
      regionCenterY: new Float64Array(5).fill(0),
      portAngleForRegion1: new Int32Array(4),
      portAngleForRegion2: new Int32Array(4),
      portX: new Float64Array([0, 1, 2, 3]),
      portY: new Float64Array(4),
      portZ: new Int32Array(4),
    }

    const problem: TinyHyperGraphProblem = {
      routeCount: 1,
      portSectionMask: new Int8Array(4).fill(1),
      routeMetadata: [{ connectionId: "blocked-route" }],
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([3]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array(5).fill(-1),
      portNetId: Int32Array.from([-1, reservedNetId, -1, -1]),
    }

    const solver = new TinyHyperGraphSolver(topology, problem)
    solver.setup()
    const blocked = reservedNetId === 1 || reservedNetId === -2
    expect(solver.failed).toBe(blocked)
    solver.state.currentRouteNetId = 0
    expect(solver.isPortReservedForDifferentNet(1)).toBe(blocked)
    if (blocked) {
      expect(solver.stats.staticallyUnroutableRouteCount).toBe(1)
    }
    for (const endpoint of [0, 3]) {
      problem.portNetId = new Int32Array(4).fill(-1)
      problem.portNetId[endpoint] = reservedNetId
      const endpointSolver = new TinyHyperGraphSolver(topology, problem, {
        STATIC_REACHABILITY_PRECHECK: false,
      })
      endpointSolver.setup()
      expect(endpointSolver.failed).toBe(blocked)
    }
  }
})
