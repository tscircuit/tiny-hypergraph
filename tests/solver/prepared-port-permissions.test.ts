import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createNativePermissionFixture, getUsedRoutePortIds, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("prepared dense expansion preserves sole owners and cannot bypass blocked goals or boundary supply", () => {
  for (const netId of [0, 1, 2]) {
    const { topology, problem } = createNativePermissionFixture(netId)
    const solver = new PreparedPortPointRoutingSolver(topology, problem, { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: false })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(getUsedRoutePortIds(solver)).toContain(netId === 0 ? 1 : 2)
    expect(getUsedRoutePortIds(solver)).not.toContain(netId === 0 ? 2 : 1)
  }
  for (const blockedPort of [0, 1, 3]) {
    const { topology, problem } = createNativePermissionFixture()
    problem.portNetId = Int32Array.from({ length: 4 }, (_, portId) => portId === blockedPort ? -2 : -1)
    problem.portSectionMask[2] = 0
    const options = { ...permissionSolveOptions, STATIC_REACHABILITY_PRECHECK: false }
    if (blockedPort !== 1) {
      expect(() => new PreparedPortPointRoutingSolver(topology, problem, options)).toThrow("does not allow")
      continue
    }
    const solver = new PreparedPortPointRoutingSolver(topology, problem, options)
    solver.solve()
    expect(solver.solved && !solver.failed).toBe(false)
    expect(solver.failed).toBe(true)
  }
  const legacy = createNativePermissionFixture(2)
  delete legacy.problem.portNetId
  const explicitFree = structuredClone(legacy)
  explicitFree.problem.portNetId = new Int32Array(4).fill(-1)
  const legacySolver = new PreparedPortPointRoutingSolver(legacy.topology, legacy.problem, permissionSolveOptions)
  const freeSolver = new PreparedPortPointRoutingSolver(explicitFree.topology, explicitFree.problem, permissionSolveOptions)
  legacySolver.solve()
  freeSolver.solve()
  expect(legacySolver.solved && !legacySolver.failed).toBe(true)
  expect(legacySolver.state.regionSegments).toEqual(freeSolver.state.regionSegments)
  expect(legacySolver.state.portAssignment).toEqual(freeSolver.state.portAssignment)
  expect(legacySolver.iterations).toBe(freeSolver.iterations)
})
