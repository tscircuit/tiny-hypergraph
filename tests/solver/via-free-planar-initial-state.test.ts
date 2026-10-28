import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("initial retained routing rejects certified planar conflicts before accepting the state", () => {
  for (const owners of [new Set<number>(), new Set([0]), new Set([1])]) {
    const { topology, problem } = createSingleLayerCompletionFixture(7, false, owners)
    problem.routeStartPort[1] = 2
    problem.routeEndPort[1] = 3
    problem.initialAssignments!.push({ routeId: 1, regionId: 0, fromPortId: 2, toPortId: 3 })
    const create = () => new TinyHyperGraphSolver(topology, problem, { STATIC_REACHABILITY_PRECHECK: false })
    if (owners.size === 0) expect(create).toThrow("cannot change layers")
    else expect(create().state.regionSegments[0].length).toBe(2)
  }
})
