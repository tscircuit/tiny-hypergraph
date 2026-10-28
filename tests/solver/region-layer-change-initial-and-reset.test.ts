import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { TinyHyperGraphSectionSolver } from "../../lib/section-solver"
import { createNativePermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("preloaded and section-replayed layer changes cannot bypass permissions and problem reset validates them", () => {
  const fixture = createNativePermissionFixture()
  fixture.problem.portSectionMask[1] = 0
  fixture.problem.regionLayerChangeAllowedNetIds = [undefined, new Set(), undefined, undefined]
  const assignments = [{ routeId: 0, regionId: 1, fromPortId: 0, toPortId: 2 }, { routeId: 0, regionId: 2, fromPortId: 2, toPortId: 3 }]
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const loaded = { ...fixture.problem, initialAssignments: assignments }
    expect(() => new Solver(fixture.topology, loaded, permissionSolveOptions)).toThrow("does not allow a layer change")
    const solver = new Solver(fixture.topology, fixture.problem, permissionSolveOptions)
    if (Solver === TinyHyperGraphSolver) expect(() => solver.resetForProblem(loaded)).toThrow("does not allow a layer change")
    for (const invalid of [[], [undefined], [undefined, []], [undefined, new Set([-1]), undefined, undefined], [undefined, new Set([0.5]), undefined, undefined]]) {
      expect(() => new Solver(fixture.topology, { ...fixture.problem, regionLayerChangeAllowedNetIds: invalid as never }, permissionSolveOptions)).toThrow()
    }
  }
  expect(() => new TinyHyperGraphSectionSolver(fixture.topology, fixture.problem, {
    solvedRoutePathSegments: [[[0, 2], [2, 3]]], solvedRoutePathRegionIds: [[1, 2]],
  })).toThrow("does not allow a layer change")
})
