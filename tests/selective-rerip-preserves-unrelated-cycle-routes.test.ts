import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import { createCrossingFinalHopSolver } from "./fixtures/createCrossingFinalHopSolver"

test("a blocker cycle rerips its members while retaining unrelated committed routing", () => {
  const crossing = createCrossingFinalHopSolver({
    layer: 0,
    crossingKind: "single_layer",
  })
  const topology: TinyHyperGraphTopology = {
    ...crossing.topology,
    portCount: 6,
    regionCount: 8,
    regionIncidentPorts: [
      ...crossing.topology.regionIncidentPorts,
      [4, 5],
      [4],
      [5],
    ],
    incidentPortRegion: [
      ...crossing.topology.incidentPortRegion,
      [5, 6],
      [5, 7],
    ],
    regionWidth: new Float64Array(8).fill(3),
    regionHeight: new Float64Array(8).fill(3),
    regionCenterX: new Float64Array([0, 0, 0, 0, 0, 1, -1, 3]),
    regionCenterY: new Float64Array([0, 0, 0, 0, 0, 10, 10, 10]),
    regionAvailableZMask: new Int32Array(8).fill(1),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000, 18000, 0]),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([1, 0, -1, 0, 0, 2]),
    portY: new Float64Array([0, 1, 0, -1, 10, 10]),
    portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 1, 4]),
    routeEndPort: new Int32Array([2, 3, 5]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array(8).fill(-1),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
      { routeId: 2, regionId: 5, fromPortId: 4, toPortId: 5 },
    ],
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    MAX_ITERATIONS: 100,
  })
  while (
    !solver.solved &&
    !solver.failed &&
    solver.getSelectiveReripStats().cycleReripCount === 0
  ) {
    solver.step()
  }

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.getSelectiveReripStats().cycleReripCount).toBe(1)
  expect(solver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(solver.state.unroutedRoutes).toEqual([0, 1])
  expect(solver.state.regionSegments[0]).toEqual([])
  expect(solver.state.regionSegments[5]).toEqual([[2, 4, 5]])
  expect(Array.from(solver.state.portAssignment)).toEqual([
    -1, -1, -1, -1, 2, 2,
  ])
  expect(solver.state.regionIntersectionCaches[5].existingSegmentCount).toBe(1)
})
