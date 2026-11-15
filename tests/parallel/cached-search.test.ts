import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { CachedRouteSearchSolver } from "../../lib/parallel/CachedRouteSearchSolver"
import { RouteSearchSolver } from "../../lib/parallel/RouteSearchSolver"
import { gridGraph } from "../fixtures/parallel-grid-graph"

test("cached scores preserve searches across nets, changed regions and prices", () => {
  const { topology, problem } = loadSerializedHyperGraph(gridGraph(5))
  const coordinator = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 10000,
    RIP_THRESHOLD_START: 0,
    RIP_THRESHOLD_END: 0,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 3,
    GREEDY_FINAL_ROUTE_ITERS: 0,
  })
  const plain = new RouteSearchSolver(topology, problem, {})
  const cached = new CachedRouteSearchSolver(topology, problem, {})
  for (const solver of [plain, cached]) {
    solver.trackReads = false
    solver.setup()
  }
  coordinator.setup()
  for (let phase = 0; phase < 10; phase++) {
    for (
      let step = 0;
      step < 40 && !coordinator.solved && !coordinator.failed;
      step++
    )
      coordinator.step()
    const prices = new Float64Array(topology.portCount).fill(phase * 0.125)
    const snapshot = {
      portAssignment: new Int32Array(coordinator.state.portAssignment),
      portPenalty: prices,
      regionCongestionCost: new Float64Array(
        coordinator.state.regionCongestionCost,
      ),
      resetRegions: phase % 3 === 0,
      regionUpdates: coordinator.state.regionIntersectionCaches.map(
        (cache, regionId) => ({ regionId, cache }),
      ),
    }
    for (const solver of [plain, cached]) solver.applySnapshot(snapshot)
    for (let repeat = 0; repeat < 2; repeat++)
      for (let route = 0; route < problem.routeCount; route++)
        expect(cached.searchRoute(route, 1000)).toEqual(
          plain.searchRoute(route, 1000),
        )
  }
})
