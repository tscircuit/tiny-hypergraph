import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "../lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "../lib/outside-in-partial-rip-tiny-hypergraph-solver"

test("retains lower congestion when a later route uses fewer segments", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 5,
    regionIncidentPorts: [[0, 1, 4], [1, 2], [2, 3, 4], [0], [3]],
    incidentPortRegion: [[0, 3], [0, 1], [1, 2], [2, 4], [0, 2]],
    regionWidth: new Float64Array(5).fill(10),
    regionHeight: new Float64Array(5).fill(10),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    portAngleForRegion1: new Int32Array(5),
    portAngleForRegion2: new Int32Array(5),
    portX: new Float64Array([0, 1, 2, 3, 1.5]),
    portY: new Float64Array([0, 1, 1, 0, 0]),
    portZ: new Int32Array(5),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(5).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(5).fill(-1),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 0, regionId: 1, fromPortId: 1, toPortId: 2 },
      { routeId: 0, regionId: 2, fromPortId: 2, toPortId: 3 },
    ],
  }
  const solver = new OutsideInPartialRipTinyHyperGraphSolver(topology, problem, {
    PARTIAL_RIP_MAX_ATTEMPTS: 0,
    PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 0,
    PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.regionIntersectionCaches[1]!.existingRegionCost = 1
  solver.onAllRoutesRouted()

  // A subsequent completed route takes the shorter corridor, but increases
  // congestion while staying inside the former first-round cost envelope.
  solver.state.regionSegments = [[[0, 0, 4]], [], [[0, 4, 3]], [], []]
  solver.state.portAssignment.set([0, -1, -1, 0, 0])
  solver.state.regionIntersectionCaches[1]!.existingRegionCost = 0
  solver.state.regionIntersectionCaches[0]!.existingRegionCost = 1.05
  solver.state.ripCount = 1
  solver.onAllRoutesRouted()

  expect(solver.solved).toBe(true)
  expect(solver.stats.bestMaxRegionCost).toBe(1)
  expect(solver.stats.bestTotalRegionCost).toBe(1)
  expect(solver.state.regionSegments).toEqual([
    [[0, 0, 1]], [[0, 1, 2]], [[0, 2, 3]], [], [],
  ])
  expect([...solver.state.portAssignment]).toEqual([0, 0, 0, 0, -1])
})
