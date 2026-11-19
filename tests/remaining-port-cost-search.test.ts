import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { PreparedPortPointRoutingSolver } from "../lib/prepared/PreparedPortPointRoutingSolver"

test("reaches a penalized destination before exploring unrelated branches", () => {
  const portCount = 67
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount: portCount,
    regionIncidentPorts: [
      [0, 1, ...Array.from({ length: portCount - 3 }, (_, index) => index + 3)],
      [1, 2],
      [0],
      ...Array.from({ length: portCount - 3 }, (_, index) => [index + 3]),
    ],
    incidentPortRegion: [
      [0, 2],
      [0, 1],
      [1],
      ...Array.from({ length: portCount - 3 }, (_, index) => [0, index + 3]),
    ],
    regionWidth: new Float64Array(portCount).fill(10),
    regionHeight: new Float64Array(portCount).fill(10),
    regionCenterX: new Float64Array(portCount),
    regionCenterY: new Float64Array(portCount),
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount),
    portX: Float64Array.from({ length: portCount }, (_, index) =>
      index < 3 ? index : -index / 10,
    ),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([2]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(portCount).fill(-1),
    portSectionMask: new Int8Array(portCount).fill(1),
    portPenalty: Float64Array.from({ length: portCount }, (_, index) =>
      index === 1 ? 150 : 0,
    ),
  }

  for (const Solver of [
    DistanceAwareTinyHyperGraphSolver,
    PreparedPortPointRoutingSolver,
  ]) {
    const solver = new Solver(topology, problem, {
      MAX_ITERATIONS: 12,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
    expect(solver.state.regionSegments[1]).toEqual([[0, 1, 2]])
  }
})
