import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createSingleRouteDisconnectedChain } from "tests/fixtures/single-route-via-capacity"

test("an exhausted single route does not repeat an unchanged empty rerip", () => {
  const { topology, problem } = createSingleRouteDisconnectedChain()
  const before = JSON.stringify({ topology, problem })
  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 2_000,
    STATIC_REACHABILITY_PRECHECK: true,
    STATIC_REACHABILITY_PRECHECK_MAX_HOPS: 4,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    minViaPadDiameter: 0.5,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.iterations).toBeLessThan(50)
  expect(solver.state.ripCount).toBe(0)
  expect(solver.error).toContain("No path")
  expect(JSON.stringify({ topology, problem })).toBe(before)
})
