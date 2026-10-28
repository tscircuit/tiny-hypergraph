import { expect, test } from "bun:test"
import { TinyHyperGraphBusSolver } from "../../lib/bus-solver/TinyHyperGraphBusSolver"
import { RegionPathSolver } from "../../lib/region-graph/region-path-solver"
import { createNativePermissionFixture, getUsedRoutePortIds, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("bus and region routing preserve separate sole-owner boundary ports and reject a foreign net", () => {
  for (const netId of [0, 1, 2]) {
    const { topology, problem } = createNativePermissionFixture(netId)
    topology.portZ[2] = 0
    problem.portNetId = Int32Array.of(-1, 0, 1, -1)
    const bus = new TinyHyperGraphBusSolver(topology, problem, { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: false })
    bus.solve()
    expect(bus.solved && !bus.failed).toBe(netId !== 2)
    if (netId !== 2) expect(getUsedRoutePortIds(bus)).toContain(netId === 0 ? 1 : 2)
    else expect(getUsedRoutePortIds(bus)).not.toContain(1)

    const region = new RegionPathSolver(topology, problem, { MAX_ITERATIONS: 500 })
    region.solve()
    expect(region.solved && !region.failed).toBe(netId !== 2)
    expect(region.state.solvedRouteRegionIds[0]!.length > 0).toBe(netId !== 2)
  }
})
