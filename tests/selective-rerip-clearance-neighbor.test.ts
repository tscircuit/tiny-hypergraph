import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

class InspectableSelectiveSolver extends SelectiveReripTinyHyperGraphSolver {
  search(forbidden: ReadonlySet<number> = new Set()) {
    return this.findRelaxedBlockerPath(forbidden)
  }

  searchPreferringPreservedRoutes() {
    return this.findRelaxedBlockerPathPreferringPreservedRoutes()
  }
}

test("selective rerip discovers movable owners of physically conflicting neighboring slots", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 7,
    regionCount: 7,
    regionIncidentPorts: [[0, 1], [1, 2, 4, 5, 6], [2, 3], [0], [3], [4], [5]],
    incidentPortRegion: [[0, 3], [0, 1], [1, 2], [2, 4], [1, 5], [1, 6], [1]],
    regionWidth: new Float64Array(7).fill(1),
    regionHeight: new Float64Array(7).fill(1),
    regionCenterX: new Float64Array(7),
    regionCenterY: new Float64Array(7),
    portAngleForRegion1: new Int32Array(7),
    portAngleForRegion2: new Int32Array(7),
    portX: new Float64Array([0, 1, 2, 3, 1, 2, 1.5]),
    portY: new Float64Array([0, 0, 0, 0, 1, 1, 1]),
    portZ: new Int32Array(7),
    portClearanceConflicts: [[], [6], [], [], [], [], [1]],
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([3, 5]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(7).fill(-1),
    portSectionMask: new Int8Array(7).fill(1),
    initialAssignments: [
      { routeId: 1, regionId: 1, fromPortId: 4, toPortId: 6 },
      { routeId: 1, regionId: 1, fromPortId: 6, toPortId: 5 },
    ],
  }
  const solver = new InspectableSelectiveSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0

  const direct = solver.search()
  expect(direct.found && [...direct.owners]).toEqual([1])
  expect(solver.search(new Set([1]))).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 1,
  })
  expect(solver.searchPreferringPreservedRoutes()).toEqual(direct)

  problem.routeIsFixed = new Uint8Array([0, 1])
  expect(solver.search()).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 1,
  })
  expect(solver.searchPreferringPreservedRoutes()).toEqual(solver.search())
  problem.routeIsFixed = undefined

  problem.regionNetId[1] = 2
  expect(solver.search()).toEqual({
    found: false,
    reason: "no_path",
    expandedLabelCount: 1,
  })
})
