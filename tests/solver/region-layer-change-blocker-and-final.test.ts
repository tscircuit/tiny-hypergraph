import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createNativePermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

class InspectableLayerChangeSolver extends SelectiveReripTinyHyperGraphSolver {
  inspectBlockers(): { found: boolean; portIds: number[] } {
    this.state.currentRouteId = 0
    this.state.currentRouteNetId = this.problem.routeNet[0]
    const result = this.findRelaxedBlockerPath()
    return { found: result.found, portIds: result.found ? result.states.map((state) => state.portId) : [] }
  }
}

test("cached blocker templates and existing final completion attempts respect the actual entry layer", () => {
  const { topology, problem } = createNativePermissionFixture()
  delete problem.portNetId
  topology.portZ.set([0, 1, 0, 1])
  problem.regionLayerChangeAllowedNetIds = [undefined, new Set(), undefined, undefined]
  const selective = new InspectableLayerChangeSolver(topology, problem, permissionSolveOptions)
  expect(selective.inspectBlockers()).toEqual({ found: true, portIds: [0, 2, 3] })
  problem.regionLayerChangeAllowedNetIds[1] = new Set([0])
  problem.regionLayerChangeAllowedNetIds[2] = new Set()
  expect(selective.inspectBlockers()).toEqual({ found: true, portIds: [0, 1, 3] })
  problem.regionLayerChangeAllowedNetIds[1] = new Set()
  expect(selective.inspectBlockers().found).toBe(false)
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const blocked = new Solver(topology, problem, { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 2 })
    blocked.tryFinalAcceptance()
    expect(blocked.solved).toBe(false)
    expect(blocked.stats.greedyFinalRouteAttemptCount).toBe(2)
    expect(blocked.state.regionSegments.flat().length).toBe(0)
    const allowed = structuredClone(problem)
    allowed.regionLayerChangeAllowedNetIds![2] = new Set([0])
    const final = new Solver(topology, allowed, { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 2 })
    final.tryFinalAcceptance()
    expect(final.solved && !final.failed).toBe(true)
    expect(final.state.regionSegments[1]).toEqual([[0, 0, 2]])
    expect(final.state.regionSegments[2]).toEqual([[0, 2, 3]])
  }
})
