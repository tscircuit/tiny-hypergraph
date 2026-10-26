import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createSingleRouteViaCapacity } from "tests/fixtures/single-route-via-capacity"

test("same-layer and sufficiently wide cross-layer single routes still solve", () => {
  for (const [width, endZ] of [[0.2, 0], [1, 1]]) {
    const { topology, problem } = createSingleRouteViaCapacity(width, endZ)
    const solver = new TinyHyperGraphSolver(topology, problem, {
      MAX_ITERATIONS: 2_000,
      STATIC_REACHABILITY_PRECHECK: true,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      minViaPadDiameter: 0.5,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.state.ripCount).toBe(0)
    expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  }
})
