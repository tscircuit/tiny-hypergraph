import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

class InspectablePhysicalBlockerSolver extends SelectiveReripTinyHyperGraphSolver {
  inspect(forbidden = new Set<number>()) {
    this.state.currentRouteId = 1
    this.state.currentRouteNetId = this.problem.routeNet[1]
    return this.findRelaxedBlockerPath(forbidden)
  }
}

test("selective search records certified multilayer crossings as removable owners using the actual incoming chord", () => {
  for (const permissions of [undefined, new Set<number>(), new Set([0]), new Set([1])]) {
    const { topology, problem } = createSingleLayerCompletionFixture(7, false, permissions)
    // Isolate the center path to inspect a physical blocker rather than the
    // otherwise available owner-free outer detour.
    problem.portSectionMask[4] = 0
    problem.portSectionMask[5] = 0
    const solver = new InspectablePhysicalBlockerSolver(topology, problem, {
      STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 0,
    })
    const result = solver.inspect()
    expect(result.found).toBe(true)
    if (!result.found) throw new Error("Expected a bounded relaxed path")
    const blocked = permissions !== undefined && permissions.size === 0
    expect([...result.owners]).toEqual(blocked ? [0] : [])
    expect(result.hops.flatMap((hop) => hop.data?.resources ?? [])
      .filter((resource) => resource.kind === "same_layer_intersection").length).toBe(blocked ? 1 : 0)
    expect(solver.inspect(new Set([0])).found).toBe(!blocked)
  }
  // With an outer path, preserving the owner is preferable to ripping it.
  const detour = createSingleLayerCompletionFixture(7, false, new Set())
  const solver = new InspectablePhysicalBlockerSolver(detour.topology, detour.problem, { STATIC_REACHABILITY_PRECHECK: false })
  const result = solver.inspect(new Set([0]))
  expect(result.found).toBe(true)
  if (!result.found) throw new Error("Expected the owner-free outer detour")
  expect([...result.owners]).toEqual([])
  expect(result.states.some((state) => state.portId === 4)).toBe(true)
})
