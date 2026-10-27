import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { createParallelGrid } from "./fixtures/createParallelGrid"

test("uniform marginal-cost increases lower-bound all transition increases", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { topology, problem } = createParallelGrid(seed)
    if (seed % 3 === 0) {
      topology.portZ.fill(0)
      topology.regionAvailableZMask!.fill(1)
    }
    const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
      TRACE_DENSITY_COST_FACTOR: seed % 2,
      minViaPadDiameter: 0.2 + seed / 100,
      STATIC_REACHABILITY_PRECHECK: false,
      VERBOSE: false,
    })
    solver.setup()
    const region = 12,
      ports = topology.regionIncidentPorts[region]!
    solver.state.currentRouteNetId = 1
    solver.appendSegmentToRegionCache(region, ports[0]!, ports[6]!)
    solver.state.currentRouteNetId = 0
    const score = (from: number, to: number): number =>
      solver.computeG(
        { portId: from, nextRegionId: region, g: 0, h: 0, f: 0 },
        to,
      )
    const before = ports.map((from) => ports.map((to) => score(from, to)))
    const baseline = score(ports[0]!, ports[0]!)
    solver.state.currentRouteNetId = 1
    solver.appendSegmentToRegionCache(region, ports[2]!, ports[8]!)
    solver.state.currentRouteNetId = 0
    const minimumIncrease = score(ports[0]!, ports[0]!) - baseline
    for (let i = 0; i < ports.length; i++)
      for (let j = 0; j < ports.length; j++) {
        const previous = before[i]![j]!
        if (!Number.isFinite(previous)) continue
        expect(
          score(ports[i]!, ports[j]!) - previous + 1e-9,
        ).toBeGreaterThanOrEqual(minimumIncrease)
      }
  }
})
