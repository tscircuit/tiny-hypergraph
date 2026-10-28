import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("ordinary and Prepared goal shortcuts preserve single-layer feasibility while retaining a legal outer path", () => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    for (const frontier of [false, true]) {
      for (const mask of [1, 2, 4, 8, 3]) {
        const { topology, problem } = createSingleLayerCompletionFixture(mask, true)
        const solver = new Solver(topology, problem, {
          MAX_ITERATIONS: 2000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          STATIC_REACHABILITY_PRECHECK: false, GREEDY_FINAL_ROUTE_ITERS: 0,
          OWNED_REGIONAL_HOP_FRONTIER: frontier, PARTIAL_RIP_ENABLED: false,
          OUTSIDE_IN_ROUTING: false,
        })
        solver.solve()
        expect(solver.solved && !solver.failed).toBe(true)
        expect(solver.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(mask === 3 ? 1 : 0)
        expect(solver.state.regionSegments[0].length).toBe(mask === 3 ? 2 : 1)
      }
    }
  }
})
