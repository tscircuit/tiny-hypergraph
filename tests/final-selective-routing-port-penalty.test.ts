import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

class FinalRouteSolver extends SelectiveReripTinyHyperGraphSolver {
  completeRemainingRoutes(): boolean {
    return this.tryGreedyFinalRouteAcceptance()
  }
}

test("final selective routing avoids a penalized bottleneck when a clear path exists", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 4,
    regionIncidentPorts: [[0, 1, 2], [1, 2, 3], [0], [3]],
    incidentPortRegion: [
      [0, 2],
      [0, 1],
      [0, 1],
      [1, 3],
    ],
    regionWidth: new Float64Array(4).fill(10),
    regionHeight: new Float64Array(4).fill(10),
    regionCenterX: new Float64Array(4),
    regionCenterY: new Float64Array(4),
    regionAvailableZMask: new Int32Array(4).fill(15),
    portAngleForRegion1: new Int32Array(4),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([0, 1, -1, 2]),
    portY: new Float64Array([0, 0, 2, 0]),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(4).fill(-1),
    portPenalty: new Float64Array([0, 150, 0, 0]),
  }
  const solver = new FinalRouteSolver(topology, problem, {
    GREEDY_FINAL_ROUTE_ITERS: 1,
  })

  expect(solver.completeRemainingRoutes()).toBe(true)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.state.portAssignment[1]).toBe(-1)
  expect(solver.state.portAssignment[2]).toBe(0)
  expect(
    solver.getOutput().solvedRoutes?.[0]?.path.map((hop) => hop.portId),
  ).toEqual(["port-0", "port-2", "port-3"])
})
