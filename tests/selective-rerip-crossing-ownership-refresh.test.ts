import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

test("blocker search preserves owner order across committed route changes", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 5,
    regionIncidentPorts: [[0, 1, 2, 3], [], [], [], []],
    incidentPortRegion: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
    regionWidth: new Float64Array(5).fill(10),
    regionHeight: new Float64Array(5).fill(10),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    regionAvailableZMask: new Int32Array(5).fill(1),
    portAngleForRegion1: new Int32Array([0, 180, 90, 270]),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([-5, 5, 0, 0]),
    portY: new Float64Array([0, 0, -5, 5]),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0, 2, 2]),
    routeEndPort: new Int32Array([1, 3, 3]),
    routeNet: new Int32Array([0, 1, 1]),
    regionNetId: new Int32Array(5).fill(-1),
  }
  class SearchableSolver extends SelectiveReripTinyHyperGraphSolver {
    searchOwners(): number[] {
      const result = this.findRelaxedBlockerPath()
      if (!result.found) throw new Error("Expected a blocker path")
      return [...result.owners]
    }
  }
  const solver = new SearchableSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.goalPortId = 1
  solver.state.regionSegments[0] = [
    [2, 2, 3],
    [1, 2, 3],
    [2, 2, 3],
  ]

  expect(solver.searchOwners()).toEqual([2, 1])

  solver.state.regionSegments[0] = []
  expect(solver.searchOwners()).toEqual([])

  solver.state.regionSegments[0] = [[1, 2, 3]]
  expect(solver.searchOwners()).toEqual([1])
})
