import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("retained snapshots and final children preserve same-side order guarantees and problem reset clears them", () => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const { topology, problem } = createSingleLayerCompletionFixture(7, false, new Set())
    topology.portX.set([-1, 1, -1, 1])
    topology.portY.set([-0.5, 0.5, 0.5, -0.5])
    problem.regionBoundaryPortOrderPreserved = Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0)
    const options = { MAX_ITERATIONS: 2_000, STATIC_REACHABILITY_PRECHECK: false,
      GREEDY_FINAL_ROUTE_ITERS: 1, RETAIN_BEST_PARTIAL_ROUTING: true }
    const solver = new Solver(topology, problem, options)
    solver.resetRoutingStateForRerip()
    solver.tryFinalAcceptance()
    expect(solver.solved && !solver.failed).toBe(true)
    if (Solver === TinyHyperGraphSolver) expect(solver.stats.retainedPartialRouteCount).toBe(1)
    expect(solver.state.regionSegments[0].length).toBe(1)
    expect(solver.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(0)
    const reset = { ...problem, regionBoundaryPortOrderPreserved: undefined }
    if (Solver === TinyHyperGraphSolver) solver.resetForProblem(reset)
    else expect(() => solver.resetForProblem(reset)).toThrow("cannot reset subclass")
    const withoutOrder = Solver === TinyHyperGraphSolver ? solver : new Solver(topology, reset, options)
    withoutOrder.tryFinalAcceptance()
    expect(withoutOrder.solved && !withoutOrder.failed).toBe(true)
    expect(withoutOrder.problem.regionBoundaryPortOrderPreserved).toBeUndefined()
    if (Solver === TinyHyperGraphSolver) {
      expect(withoutOrder.state.regionSegments[0].length).toBe(2)
      expect(withoutOrder.state.regionIntersectionCaches[0].existingSameLayerIntersections).toBe(1)
    }
  }
})
